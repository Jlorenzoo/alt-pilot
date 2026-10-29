'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { attachSession } = require('./client')
const { createSerializer } = require('bedrock-protocol/src/transforms/serializer')
const { parseCommand } = require('./chat-controls')

function setup (t, { full = false, legacy = false, hotbar = false, palette = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-hold-xp-'))
  fs.mkdirSync(path.join(root, 'bedrock'))
  const client = new EventEmitter(), sent = [], logs = []
  let clock = 10000
  client.entityId = 123n
  client.username = 'TestAlt'
  client.options = { host: '127.0.0.1' }
  client.queue = (name, packet) => sent.push([name, packet])
  client.close = () => {}
  client.versionGreaterThanOrEqualTo = () => true
  const session = attachSession(client, { root, profile: { name: 'TestAlt' }, settings: { tpa_whitelist: 'Admin' },
    now: () => clock, log: msg => logs.push(msg), quit: () => {} })
  const empty = () => ({ network_id: 0 })
  const stack = (id, count, stackId) => ({ network_id: id, count, metadata: 0, block_runtime_id: 0, has_stack_id: true, stack_id: stackId,
    extra: { has_nbt: true, nbt: { version: 1, nbt: { type: 'compound', name: '', value: { label: { type: 'string', value: 'Keep custom XP bottle' } } } }, can_place_on: [], can_destroy: [] } })
  const bottle = stack(789, 4, 22)
  const input = Array.from({ length: 36 }, (_, i) => full ? stack(1, 64, i + 100) : empty())
  input[hotbar ? 5 : 17] = bottle
  client.emit('start_game', { item_stack_net_manager_enabled: !legacy, itemstates: palette ? [{ name: 'minecraft:experience_bottle', runtime_id: 789 }] : [] })
  client.emit('spawn')
  client.emit('move_player', { runtime_id: 123n, position: { x: 1, y: 64, z: 1 } })
  client.emit('inventory_content', { window_id: 'inventory', input })
  t.after(async () => { session.finish('done', 0); await new Promise(resolve => setTimeout(resolve, 120)); fs.rmSync(root, { recursive: true }) })
  const request = () => sent.find(([name]) => name === 'item_stack_request')?.[1].requests[0]
  const answer = (status = 'ok', id = request()?.request_id) => client.emit('item_stack_response', { responses: [{ status, request_id: id,
    containers: [{ slot_type: { container_id: 'hotbar_and_inventory', dynamic_container_id: null }, slots: [
      { slot: 17, count: input[0].count || 0, item_stack_id: input[0].stack_id || 0 },
      { slot: 0, count: bottle.count, item_stack_id: 888 }
    ] }] }] })
  return { root, client, session, sent, logs, input, bottle, request, answer, advance: () => { clock += 2100 } }
}

test('hold command uses exact authenticated chat grammar', () => {
  for (const packet of [{ type: 'whisper', source_name: 'Admin', message: 'item hold xp' },
    { type: 'raw', message: 'Skyblock [Member] Admin ➜ You: item hold xp' }]) {
    assert.deepEqual(parseCommand(packet, 'TestAlt'), { sender: 'Admin', command: 'item hold xp' })
  }
  for (const message of ['Admin: item hold xp extra', 'Evil: Admin: item hold xp', '[Admin -> OtherAlt] item hold xp']) {
    assert.equal(parseCommand({ type: 'raw', message }, 'TestAlt'), null)
  }
})

test('already-hotbar bottle is selected without inventory movement or use', async t => {
  const { session, sent } = setup(t, { hotbar: true })
  assert.match(session.send('item hold xp'), /Selected/)
  assert.deepEqual(sent.map(([name]) => name), ['mob_equipment'])
  assert.equal(sent[0][1].selected_slot, 5)
})

for (const full of [false, true]) test(`server-approved swap preserves both stacks with ${full ? 'full' : 'empty'} hotbar`, async t => {
  const { client, session, sent, request, answer, bottle, input, advance } = setup(t, { full })
  assert.match(session.send('item hold xp'), /waiting for server confirmation/)
  assert.equal(sent.length, 2)
  const req = request()
  assert.equal(req.actions[0].type_id, 'swap')
  assert.equal(req.actions[0].source.slot, 17)
  assert.equal(req.actions[0].destination.slot, 0)
  assert.equal(req.actions[0].destination.stack_id, full ? 100 : 0)
  for (const version of ['1.21.100', '1.26.45', '1.26.51']) {
    assert.doesNotThrow(() => createSerializer(version).createPacketBuffer({ name: 'item_stack_request', params: sent[1][1] }))
  }
  assert.equal(sent[0][0], 'interact', 'open inventory before sending the stack request')
  client.emit('container_open', { window_id: 'inventory', window_type: 'inventory' })
  client.emit('inventory_content', { window_id: 'inventory', input })
  advance()
  assert.match(session.send('item hold xp'), /previous inventory action|Close the open/)
  session.send('item use')
  assert.equal(sent.length, 2, 'all item operations wait for acknowledgement')
  answer('ok', req.request_id + 1)
  assert.equal(sent.length, 2, 'unrelated response cannot equip')
  answer()
  assert.equal(sent[2][0], 'container_close', 'close only the inventory opened by this command')
  assert.equal(sent[3][0], 'mob_equipment')
  assert.deepEqual(sent[3][1].item.extra, bottle.extra)
  session.send('item use')
  assert.equal(sent[4][0], 'inventory_transaction')
  assert.equal(sent[4][1].transaction.transaction_data.held_item.stack_id, 888)
  assert.deepEqual(input[17], bottle, 'no speculative source mutation')
})

test('server rejection refreshes inventory and never equips or repeats the move', async t => {
  const { session, sent, answer, advance, client, input } = setup(t)
  session.send('item hold xp'); answer('error')
  assert.equal(sent.filter(([name]) => name === 'player_hotbar').length, 0)
  assert.equal(sent.filter(([name]) => name === 'item_stack_request').length, 1)
  assert.equal(sent.at(-1)[0], 'interact')
  advance(); session.send('item hold xp')
  assert.equal(sent.filter(([name]) => name === 'item_stack_request').length, 1)
  client.emit('inventory_content', { window_id: 'inventory', input })
})

test('full inventory snapshot confirms a swap and respawn discards pending work', async t => {
  const { session, sent, client, input, bottle, answer } = setup(t, { full: true })
  session.send('item hold xp')
  const moved = input.slice(); [moved[0], moved[17]] = [moved[17], moved[0]]
  client.emit('inventory_content', { window_id: 'inventory', input: moved })
  assert.deepEqual(sent.find(([name]) => name === 'mob_equipment')[1].item.extra, bottle.extra)
  client.emit('respawn', {})
  const before = sent.length; answer('ok', 1)
  assert.equal(sent.length, before)
})

test('legacy swap transaction conserves complete stacks and serializes both formats', async t => {
  const { session, sent, client, input, bottle } = setup(t, { full: true, legacy: true })
  session.send('item hold xp')
  const packet = sent[0][1]
  const [source, destination] = packet.transaction.actions
  assert.deepEqual(source.old_item, bottle)
  assert.deepEqual(source.new_item, destination.old_item)
  assert.deepEqual(destination.new_item, bottle)
  for (const version of ['1.21.100', '1.26.45', '1.26.51']) {
    const params = structuredClone(packet)
    if (version === '1.21.100') for (const action of params.transaction.actions) {
      action.old_item.has_stack_id = Number(action.old_item.has_stack_id)
      action.new_item.has_stack_id = Number(action.new_item.has_stack_id)
    }
    assert.doesNotThrow(() => createSerializer(version).createPacketBuffer({ name: 'inventory_transaction', params }))
  }
  client.emit('inventory_slot', { window_id: 'inventory', slot: 0, item: bottle })
  assert.equal(sent.length, 1, 'one updated slot is insufficient')
  client.emit('inventory_slot', { window_id: 'inventory', slot: 17, item: input[0] })
  assert.equal(sent[1][0], 'mob_equipment')
})

test('missing palette, missing bottle, menus and unauthorized players cannot move items', async t => {
  const { client, session, sent, input } = setup(t, { palette: false })
  assert.match(session.send('item hold xp'), /palette/)
  assert.equal(sent.length, 0)
  client.emit('item_registry', { itemstates: [{ name: 'minecraft:experience_bottle', runtime_id: 789 }] })
  client.emit('text', { type: 'chat', source_name: 'Evil', message: 'item hold xp' })
  assert.equal(sent.length, 0)
  client.emit('container_open', { window_id: 5, window_type: 'container' })
  assert.match(session.send('item hold xp'), /Close/)
  client.emit('container_close', { window_id: 5 })
  client.emit('inventory_content', { window_id: 'inventory', input: input.map(() => ({ network_id: 0 })) })
  assert.match(session.send('item hold xp'), /No XP bottle/)
  assert.equal(sent.filter(([name]) => name === 'item_stack_request').length, 0)
})

test('whitelisted chat equips through the same inventory action', async t => {
  const { client, sent } = setup(t)
  client.emit('text', { type: 'whisper', source_name: 'Admin', message: 'item hold xp' })
  assert.equal(sent[0][0], 'interact')
  assert.equal(sent[1][0], 'item_stack_request')
  assert.match(sent[2][1].command, /^\/msg Admin XP bottle move requested/)
})

test('missing stack IDs and uncertain writes never fabricate inventory or retry', async t => {
  const { session, client, sent, input, advance } = setup(t)
  const withoutId = structuredClone(input[17]); delete withoutId.stack_id
  client.emit('inventory_slot', { window_id: 'inventory', slot: 17, item: withoutId })
  assert.match(session.send('item hold xp'), /stack IDs/)
  assert.equal(sent.filter(([name]) => name === 'item_stack_request').length, 0)
  client.emit('container_open', { window_id: 'inventory', window_type: 'inventory' })
  client.emit('inventory_content', { window_id: 'inventory', input })
  advance()
  client.queue = (name, packet) => {
    if (name === 'item_stack_request') throw new Error('uncertain write')
    sent.push([name, packet])
  }
  assert.match(session.send('item hold xp'), /could not be confirmed/)
  advance()
  assert.match(session.send('item hold xp'), /previous inventory action|Close the open/)
  assert.equal(sent.filter(([name]) => name === 'player_hotbar').length, 0)
})

test('unanswered move requests refresh once without repeating the swap', async t => {
  const { session, sent } = setup(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  session.send('item hold xp')
  t.mock.timers.tick(3000)
  t.mock.timers.tick(3000)
  t.mock.timers.reset()
  assert.equal(sent.filter(([name]) => name === 'item_stack_request').length, 1)
  assert.equal(sent.filter(([name]) => name === 'interact').length, 2)
  assert.equal(sent.filter(([name]) => name === 'player_hotbar').length, 0)
})

test('selection sends only the client-to-server equipment packet and serializes the exact bottle', async t => {
  const { session, sent, bottle } = setup(t, { hotbar: true })
  session.send('item hold xp')
  assert.equal(sent.length, 1)
  assert.equal(sent[0][0], 'mob_equipment')
  assert.equal(sent[0][1].selected_slot, 5)
  assert.equal(sent[0][1].slot, 5)
  assert.equal(sent[0][1].runtime_entity_id, 123n)
  assert.deepEqual(sent[0][1].item.extra, bottle.extra)
  assert.equal(sent[0][1].item.has_stack_id, false)
  assert.equal(sent[0][1].item.stack_id, undefined)
  assert.equal(bottle.stack_id, 22, 'authoritative inventory keeps its stack ID')
  for (const version of ['1.21.100', '1.26.45', '1.26.51']) {
    const params = structuredClone(sent[0][1])
    if (version === '1.21.100') params.item.has_stack_id = 0
    assert.doesNotThrow(() => createSerializer(version).createPacketBuffer({ name: 'mob_equipment', params }))
  }
})

test('failed selection is reported, preserves held slot and blocks targeted use/drop', async t => {
  const { session, client, sent, advance } = setup(t, { full: true, hotbar: true })
  client.queue = (name, params) => {
    if (name === 'mob_equipment') throw new Error('equipment write failed')
    sent.push([name, params])
  }
  assert.match(session.send('slot 6'), /Could not select/)
  assert.match(session.send('useitem 6'), /no item action was sent/)
  assert.match(session.send('dropitem 6'), /no item action was sent/)
  assert.equal(sent.length, 0)
  advance()
  session.send('item use')
  assert.equal(sent[0][1].transaction.transaction_data.hotbar_slot, 0)
  assert.equal(sent[0][1].transaction.transaction_data.held_item.network_id, 1)
})

test('equipment bytes match the packet accepted by independent Geyser 2169', async t => {
  const { client, session, sent } = setup(t)
  client.entityId = 3n
  client.emit('inventory_slot', { window_id: 'inventory', slot: 3, item: {
    network_id: 519, count: 1, metadata: 0, has_stack_id: true, stack_id: 4,
    block_runtime_id: 0, extra: { has_nbt: false, can_place_on: [], can_destroy: [] }
  } })
  session.send('slot 4')
  assert.equal(sent.length, 1)
  const encoded = createSerializer('1.26.45').createPacketBuffer({ name: sent[0][0], params: sent[0][1] })
  const golden = fs.readFileSync(path.join(__dirname, 'fixtures/geyser-2169-equipment.hex'), 'utf8').trim()
  assert.equal(encoded.toString('hex'), golden)
})

test('use xp finds a hotbar bottle and sends exactly one use', async t => {
  const { client, sent, advance } = setup(t, { hotbar: true })
  client.emit('text', { type: 'whisper', source_name: 'Evil', message: 'use xp' })
  assert.equal(sent.length, 0)
  client.emit('text', { type: 'whisper', source_name: 'Admin', message: 'use xp' })
  const uses = () => sent.filter(([name, p]) => name === 'inventory_transaction' && p.transaction.transaction_type === 'item_use')
  assert.equal(uses().length, 1)
  assert.equal(uses()[0][1].transaction.transaction_data.hotbar_slot, 5)
  advance()
  client.emit('text', { type: 'whisper', source_name: 'Admin', message: 'use xp' })
  assert.equal(uses().length, 1, 'no second use before fresh server inventory')
})

test('use xp waits for an approved swap, uses once, and replies to its sender', async t => {
  const { client, sent, answer } = setup(t, { full: true })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  client.emit('text', { type: 'whisper', source_name: 'Admin', message: 'use xp' })
  assert.equal(sent.filter(([name]) => name === 'inventory_transaction').length, 0)
  answer()
  const uses = sent.filter(([name]) => name === 'inventory_transaction')
  assert.equal(uses.length, 1)
  assert.equal(uses[0][1].transaction.transaction_data.held_item.stack_id, 888)
  answer()
  assert.equal(sent.filter(([name]) => name === 'inventory_transaction').length, 1)
  t.mock.timers.tick(1250)
  t.mock.timers.reset()
  assert.ok(sent.some(([name, p]) => name === 'command_request' && /Use-item request sent/.test(p.command)))
})

test('rejected and timed out XP moves never consume a bottle', async t => {
  const { session, sent, answer } = setup(t)
  session.send('use xp')
  answer('error')
  assert.equal(sent.filter(([name]) => name === 'inventory_transaction').length, 0)
})

test('late move acknowledgement after timeout equips but never uses', async t => {
  const { session, sent, answer } = setup(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  session.send('use xp')
  t.mock.timers.tick(3000)
  answer()
  t.mock.timers.reset()
  assert.equal(sent.filter(([name]) => name === 'inventory_transaction').length, 0)
})

test('natural XP aliases keep the exact sender and recipient grammar', () => {
  for (const command of ['use xp', 'item use xp', 'USE XP']) {
    assert.equal(parseCommand({ type: 'whisper', source_name: 'Admin', message: command }, 'TestAlt').command, command.toLowerCase())
  }
  for (const message of ['Evil: Admin: use xp', '[Admin -> OtherAlt] use xp', 'Admin: use xp all', 'Admin: please use xp']) {
    assert.equal(parseCommand({ type: 'raw', message }, 'TestAlt'), null)
  }
})

test('whitelist revocation while an XP move is pending cancels use', async t => {
  const { root, client, sent, answer } = setup(t)
  client.emit('text', { type: 'whisper', source_name: 'Admin', message: 'use xp' })
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ tpa_whitelist: 'Other' }))
  answer()
  assert.equal(sent.filter(([name]) => name === 'inventory_transaction').length, 0)
})

for (const legacy of [false, true]) test('use xp accepts authoritative inventory snapshots; legacy=' + legacy, async t => {
  const { session, client, sent, input } = setup(t, { legacy })
  session.send('item use xp')
  const moved = input.slice(); [moved[0], moved[17]] = [moved[17], moved[0]]
  client.emit('inventory_content', { window_id: 'inventory', input: moved })
  client.emit('inventory_content', { window_id: 'inventory', input: moved })
  const uses = sent.filter(([name, p]) => name === 'inventory_transaction' && p.transaction.transaction_type === 'item_use')
  assert.equal(uses.length, 1)
  assert.equal(uses[0][1].transaction.transaction_data.held_item.network_id, 789)
})

test('use xp does not use another held item if selecting the bottle fails', async t => {
  const { session, client, sent } = setup(t, { hotbar: true, full: true })
  const queue = client.queue
  client.queue = (name, packet) => {
    if (name === 'mob_equipment') throw new Error('selection failed')
    queue(name, packet)
  }
  assert.match(session.send('use xp'), /Could not select/)
  assert.equal(sent.filter(([name]) => name === 'inventory_transaction').length, 0)
})
