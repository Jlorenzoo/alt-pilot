'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { profileFromChain, endpoint, resolveHost, attachSession, safeError, bedrockLicenseError, bedrockLicenseMessage, sessionAuthOptions, PLATFORM, isPacketReadError } = require('./client')

test('isPacketReadError recognizes RakNet and protocol deserialization errors', () => {
  assert.equal(isPacketReadError(new Error('Read error for undefined : Invalid tag: 115 > 20')), true)
  assert.equal(isPacketReadError({ name: 'PartialReadError', message: 'buffer too small' }), true)
  assert.equal(isPacketReadError({ field: 'params.metadata' }), true)
  assert.equal(isPacketReadError(new Error('Connection reset by peer')), false)
})

test('resolveHost resolves hostnames and leaves raw IPs intact', async () => {
  assert.equal(await resolveHost('127.0.0.1'), '127.0.0.1')
  const resolved = await resolveHost('localhost')
  assert.match(resolved, /^(127\.0\.0\.1|localhost)$/)
})

test('only a complete Xbox identity can be saved', () => {
  const jwt = data => 'header.' + Buffer.from(JSON.stringify(data)).toString('base64url') + '.sig'
  const extraData = { displayName: 'BedrockAlt', identity: 'uuid', XUID: '12345' }
  assert.deepEqual(profileFromChain([jwt({}), jwt({ extraData })]), { name: 'BedrockAlt', uuid: 'uuid', xuid: '12345' })
  assert.throws(() => profileFromChain([jwt({ extraData: { displayName: 'Player' } })]))
})
test('Java Skyblock address routes through the Bedrock entry point', () => {
  assert.deepEqual(endpoint('skyblock.mc-complex.com'), { host: 'eu.mc-complex.com', port: 19132 })
  assert.equal(endpoint('eu.mc-complex.com:25565').port, 19132)
})
test('sensitive error values are removed', () => {
  assert.equal(safeError(new Error('a@b.com eyJabc.eyJdef.signature')), '[email removed] [token removed]')
})
test('bedrock license errors are recognized', () => {
  assert.equal(bedrockLicenseError('{"error":"UNAUTHORIZED"}'), true)
  assert.equal(bedrockLicenseError('{ "path" : "/multiplayer/bedrock/authentication", "error" : "UNAUTHORIZED" }'), true)
  assert.equal(bedrockLicenseError('does not own Minecraft Bedrock Edition'), true)
  assert.equal(bedrockLicenseError('unauthorized_client'), false)
  assert.equal(bedrockLicenseError('401 from multiplayer.minecraft.net'), false)
  assert.equal(bedrockLicenseError('Profile was not found'), false)
  assert.match(bedrockLicenseMessage(), /minecraft.com is a different check/)
})
test('Bedrock sessions always use the Nintendo Switch platform', () => {
  const { Titles } = require('prismarine-auth')
  assert.equal(PLATFORM.deviceType, 'Nintendo')
  assert.equal(PLATFORM.authTitle, Titles.MinecraftNintendoSwitch)
  assert.deepEqual(sessionAuthOptions(), { authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo', flow: 'live', deviceOS: 12 })
})
test('spawn, commands, disconnect and identity mismatch update actual state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-pilot-bedrock-test-'))
  fs.mkdirSync(path.join(root, 'bedrock'))
  const client = new EventEmitter()
  const sent = []
  client.queue = (name, data) => sent.push([name, data])
  client.close = () => {}
  client.username = 'Test'
  client.versionGreaterThanOrEqualTo = () => true
  const session = attachSession(client, { root, profile: { xuid: '123' }, log: () => {}, quit: () => {} })
  const state = () => JSON.parse(fs.readFileSync(path.join(root, 'bedrock/status.json')))
  session.send('/home alt'); assert.equal(sent.length, 0)
  client.emit('session', { xuid: '123' }); assert.equal(state().connected, false)
  client.emit('spawn'); assert.equal(state().connected, true)
  session.send('/home alt'); assert.equal(sent[0][0], 'command_request'); assert.equal(sent[0][1].version, 'latest')
  session.send('hello'); assert.equal(sent[1][0], 'text')
  // Serialize our command against both currently supported packet formats.
  const { createSerializer } = require('bedrock-protocol/src/transforms/serializer')
  createSerializer('1.26.45').createPacketBuffer({ name: sent[0][0], params: sent[0][1] })
  createSerializer('1.21.100').createPacketBuffer({ name: sent[0][0], params: { ...sent[0][1], version: 66 } })
  client.emit('session', { xuid: '456' }); assert.equal(state().connected, false)
  session.send('/home alt'); assert.equal(sent.length, 2)
  await new Promise(resolve => setTimeout(resolve, 120))
  fs.rmSync(root, { recursive: true })
})


function actionSession (t, { dropEnabled, settings = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-pilot-actions-'))
  fs.mkdirSync(path.join(root, 'bedrock'))
  const client = new EventEmitter()
  const sent = [], logs = []
  let clock = 10000
  client.queue = (name, data) => sent.push([name, data])
  client.close = () => {}
  client.versionGreaterThanOrEqualTo = () => true
  client.entityId = 12345n
  client.options = { host: '127.0.0.1' }
  const session = attachSession(client, { root, profile: { xuid: '123' }, settings, log: msg => logs.push(msg), quit: () => {}, now: () => clock, dropEnabled })
  const item = { network_id: 250, count: 5, metadata: 0, has_stack_id: true, stack_id: 23,
    block_runtime_id: 0, extra: { has_nbt: true, nbt: { version: 1, nbt: { type: 'compound', name: '', value: { label: { type: 'string', value: 'Keep this data' } } } }, can_place_on: [], can_destroy: [] } }
  const refresh = value => client.emit('inventory_slot', { window_id: 'inventory', slot: 2, item: value })
  const select = () => client.emit('mob_equipment', { runtime_entity_id: 12345n, window_id: 'inventory', selected_slot: 2, item })
  t.after(async () => {
    session.finish('test complete', 0)
    await new Promise(resolve => setTimeout(resolve, 120))
    fs.rmSync(root, { recursive: true })
  })
  return { root, client, session, sent, logs, item, refresh, select, advance: () => { clock += 2100 } }
}

// Legacy stack presence is a numeric byte; modern ItemV4 uses a boolean.
function packetForVersion (packet, version) {
  const copy = structuredClone(packet)
  const items = copy.transaction.actions.flatMap(action => [action.old_item, action.new_item])
  if (version === '1.21.100') for (const item of items) item.has_stack_id = Number(Boolean(item.has_stack_id))
  return copy
}

test('drop conserves item count and NBT and round-trips both protocol formats', async t => {
  const { client, session, sent, logs, item, select } = actionSession(t)
  client.emit('spawn')
  select()
  client.emit('inventory_content', { window_id: 'inventory', input: [{ network_id: 0 }, { network_id: 0 }, item] })
  session.send('\\dropitem')
  assert.equal(sent.length, 1, 'only one transaction, no duplicate player_action')
  const actions = sent[0][1].transaction.actions
  assert.equal(actions[0].slot, 2)
  assert.equal(actions[0].old_item.count, 5)
  assert.equal(actions[0].new_item.count, 4)
  assert.equal(actions[1].new_item.count, 1)
  assert.deepEqual(actions[1].new_item.extra, item.extra)
  assert.equal(item.count, 5, 'server inventory is not mutated speculatively')
  assert.equal(actions[0].new_item.stack_id, 23)
  assert.equal(actions[1].new_item.has_stack_id, false)
  const { createSerializer, createDeserializer } = require('bedrock-protocol/src/transforms/serializer')
  for (const version of ['1.21.100', '1.26.45']) {
    const encoded = createSerializer(version).createPacketBuffer({ name: sent[0][0], params: packetForVersion(sent[0][1], version) })
    const decoded = createDeserializer(version).parsePacketBuffer(encoded).data.params.transaction.actions
    assert.equal(decoded[0].old_item.count, decoded[0].new_item.count + decoded[1].new_item.count)
    assert.equal(decoded[1].flags, 0)
    assert.deepEqual(decoded[1].new_item.extra, item.extra)
    if (version === '1.26.45') {
      assert.equal(decoded[0].container_presence, true)
      assert.equal(decoded[0].window_id, 0)
      assert.equal(decoded[1].flag_presence, true)
    } else assert.equal(decoded[0].inventory_id, 'inventory')
  }
  assert.match(logs.at(-1), /request sent; awaiting/)
})

test('last item becomes a complete serializable empty stack', async t => {
  const { client, session, sent, item, refresh, select } = actionSession(t)
  client.emit('spawn'); select(); refresh({ ...item, count: 1 })
  session.dropItem()
  assert.equal(sent[0][1].transaction.actions[0].new_item.network_id, 0)
  const { createSerializer, createDeserializer } = require('bedrock-protocol/src/transforms/serializer')
  for (const version of ['1.21.100', '1.26.45']) {
    const buffer = createSerializer(version).createPacketBuffer({ name: sent[0][0], params: packetForVersion(sent[0][1], version) })
    const data = createDeserializer(version).parsePacketBuffer(buffer).data.params
    assert.equal(data.transaction.actions[0].new_item.network_id, 0)
  }
})

test('unknown, empty, invalid, foreign and open-container inventory cannot trigger a drop', async t => {
  const { client, session, sent, item, refresh, select } = actionSession(t)
  session.dropItem(); client.emit('spawn'); select(); session.dropItem()
  client.emit('inventory_slot', { window_id: 'offhand', slot: 2, item }); session.dropItem()
  for (const value of [{ network_id: 0 }, { ...item, count: 0 }, { ...item, extra: undefined }]) {
    refresh(value); session.dropItem()
  }
  refresh(item); client.emit('container_open', {}); session.dropItem()
  assert.equal(sent.length, 0)
  client.emit('container_close', {}); session.dropItem()
  assert.equal(sent.length, 1)
})

test('repeat clicks and use are blocked until server refresh, then cooldown applies', async t => {
  const { client, session, sent, item, refresh, select, advance, logs } = actionSession(t)
  client.emit('spawn'); select(); refresh(item); session.dropItem()
  advance(); session.dropItem(); session.useItem()
  // Foreign equipment and other slots must not unlock the pending drop.
  client.emit('mob_equipment', { runtime_entity_id: 999n, window_id: 'inventory', selected_slot: 3, item })
  client.emit('inventory_slot', { window_id: 'inventory', slot: 3, item })
  session.dropItem(); assert.equal(sent.length, 1)
  refresh({ ...item, count: 4 })
  assert.match(logs.at(-1), /matches/)
  session.dropItem(); assert.equal(sent.length, 2)
  refresh({ ...item, count: 3 }); session.dropItem()
  assert.equal(sent.length, 2, 'cooldown also applies after acknowledgement')
  advance(); session.dropItem(); assert.equal(sent.length, 3)
})

test('server correction is reported and dimension changes invalidate cached inventory', async t => {
  const { client, session, sent, logs, item, refresh, select, advance } = actionSession(t)
  client.emit('spawn'); select(); refresh(item); session.dropItem(); refresh(item)
  assert.match(logs.at(-1), /not confirmed/)
  advance(); client.emit('change_dimension', {}); advance(); session.dropItem()
  assert.equal(sent.length, 1)
  refresh(item); session.dropItem(); assert.equal(sent.length, 2)
})

test('use consumes only fresh inventory and serialization failure never sends a fallback', async t => {
  const { client, session, sent, logs, item, refresh, select, advance } = actionSession(t)
  client.emit('spawn'); select(); refresh(item)
  client.emit('start_game', { player_position: { x: 1, y: 64, z: 2 } })
  client.emit('move_player', { runtime_id: 12345n, position: { x: 3, y: 64, z: 4 } })
  client.emit('move_player', { runtime_id: 999n, position: { x: 999, y: 0, z: 999 } })
  session.useItem()
  assert.deepEqual(sent[0][1].transaction.transaction_data.player_pos, { x: 3, y: 64, z: 4 })
  const { createSerializer } = require('bedrock-protocol/src/transforms/serializer')
  for (const version of ['1.21.100', '1.26.45']) createSerializer(version).createPacketBuffer({ name: sent[0][0], params: sent[0][1] })
  advance(); session.dropItem(); assert.equal(sent.length, 1)
  refresh(item)
  let attempts = 0
  client.queue = () => { attempts++; throw new Error('serialization failed') }
  session.dropItem(); session.dropItem()
  assert.equal(attempts, 1)
  assert.ok(logs.some(msg => /Could not drop item: serialization failed/.test(msg)))
  assert.equal(sent.length, 1)
})


test('legacy inventory stack flags produce a complete decodable drop without conversion', async t => {
  const { client, session, sent, item, refresh, select } = actionSession(t)
  client.emit('spawn'); select(); refresh({ ...item, has_stack_id: 1 })
  session.dropItem()
  const { createSerializer, createDeserializer } = require('bedrock-protocol/src/transforms/serializer')
  const bytes = createSerializer('1.21.100').createPacketBuffer({ name: sent[0][0], params: sent[0][1] })
  const actions = createDeserializer('1.21.100').parsePacketBuffer(bytes).data.params.transaction.actions
  assert.equal(actions[0].new_item.count, 4)
  assert.equal(actions[1].new_item.has_stack_id, 0)
  assert.equal(actions[1].new_item.count, 1)
  assert.deepEqual(actions[1].new_item.extra.nbt, item.extra.nbt)
})


test('a rejected Skyblock route preserves inventory while actions stay blocked in transit', async t => {
  const { client, session, sent, logs, item, refresh, select, advance } = actionSession(t)
  client.username = 'Test'
  client.versionGreaterThanOrEqualTo = () => true
  client.emit('spawn'); select(); refresh(item)
  session.send('/skyblock')
  advance(); session.dropItem()
  assert.equal(sent.length, 1, 'route has not yet resolved')
  assert.match(logs.at(-1), /server route/)
  client.emit('text', { message: "§r§c§l! §r§cYou're already on Skyblock!" })
  session.dropItem()
  assert.equal(sent.length, 2, 'the unchanged server snapshot is still usable')
  assert.equal(sent[1][1].transaction.actions[0].old_item.count, 5)
})

test('actual routing still clears old inventory and requires a destination snapshot', async t => {
  const { client, session, sent, logs, item, refresh, select, advance } = actionSession(t)
  client.username = 'Test'
  client.versionGreaterThanOrEqualTo = () => true
  client.emit('spawn'); select(); refresh(item)
  session.send('/skyblock')
  client.emit('change_dimension', {})
  advance(); session.dropItem()
  assert.equal(sent.length, 1)
  client.emit('inventory_content', { window_id: 'inventory', input: [{ network_id: 0 }, { network_id: 0 }, { ...item, count: 3 }] })
  session.send('\\itemstatus')
  assert.match(logs.at(-1), /inventory=known.*count=3/)
  session.dropItem()
  assert.equal(sent.length, 2)
  assert.equal(sent[1][1].transaction.actions[0].old_item.count, 3)
})


test('explicit session disable blocks every drop entry point without queuing a packet', async t => {
  const { client, session, sent, item, refresh, select, logs } = actionSession(t, { dropEnabled: false })
  client.emit('spawn'); select(); refresh(item)
  session.dropItem(); session.send('\\dropitem'); session.send('!dropitem')
  assert.equal(sent.length, 0)
  assert.equal(logs.filter(message => /dropping is disabled/.test(message)).length, 3)
})


test('default session enables one guarded drop through the console alias', async t => {
  const { client, session, sent, item, refresh, select } = actionSession(t)
  client.emit('spawn'); select(); refresh(item)
  session.send('\\dropitem'); session.send('!dropitem')
  assert.equal(sent.length, 1)
  assert.equal(sent[0][0], 'inventory_transaction')
})

test('drop requests an inventory snapshot once and closes only its own main inventory', async t => {
  const { client, session, sent, item, refresh, select, advance, logs } = actionSession(t)
  client.emit('spawn'); select(); refresh(item); session.dropItem()
  await new Promise(resolve => setTimeout(resolve, 350))
  assert.equal(sent.length, 2)
  assert.equal(sent[1][0], 'interact')
  assert.equal(sent[1][1].action_id, 'open_inventory')
  client.emit('container_open', { window_id: 'inventory', window_type: 'inventory' })
  client.emit('inventory_content', { window_id: 'inventory', input: [{ network_id: 0 }, { network_id: 0 }, { ...item, count: 4 }] })
  assert.equal(sent[2][0], 'container_close')
  assert.equal(sent[2][1].window_id, 'inventory')
  assert.ok(logs.some(message => /matches/.test(message)))
  advance(); session.dropItem()
  assert.equal(sent.length, 4)
})

test('a different open container is never automatically closed by the snapshot request', async t => {
  const { client, session, sent, item, refresh, select } = actionSession(t)
  client.emit('spawn'); select(); refresh(item); session.dropItem()
  await new Promise(resolve => setTimeout(resolve, 350))
  client.emit('container_open', { window_id: 5, window_type: 'container' })
  client.emit('inventory_content', { window_id: 'inventory', input: [{ network_id: 0 }, { network_id: 0 }, { ...item, count: 4 }] })
  assert.equal(sent.length, 2)
  session.dropItem(); assert.equal(sent.length, 2)
})


test('drop encoding matches a packet accepted by the independent Geyser 2169 codec', async t => {
  const { client, session, sent } = actionSession(t)
  client.emit('spawn')
  client.emit('inventory_slot', { window_id: 'inventory', slot: 0, item: { network_id: 4, count: 3, metadata: 0, has_stack_id: true, stack_id: 2,
    block_runtime_id: 5824, extra: { has_nbt: 0, can_place_on: [], can_destroy: [] } } })
  session.dropItem()
  const { createSerializer } = require('bedrock-protocol/src/transforms/serializer')
  const bytes = createSerializer('1.26.45').createPacketBuffer({ name: sent[0][0], params: sent[0][1] })
  assert.equal(bytes.toString('hex'), fs.readFileSync(path.join(__dirname, 'fixtures/geyser-2169-drop.hex'), 'utf8').trim())
})


test('whitelisted chat uses the same guarded drop path; other players cannot trigger it', async t => {
  const { client, session, sent, item, refresh, select } = actionSession(t, { settings: { tpa_whitelist: 'Admin' } })
  client.emit('spawn'); select(); refresh(item)
  client.emit('text', { type: 'raw', message: '[Rank] Evil: item drop' })
  client.emit('text', { type: 'raw', message: 'Evil: Admin: item drop' })
  assert.equal(sent.length, 0)
  client.emit('text', { type: 'raw', message: '[Rank] Admin: item drop' })
  client.emit('text', { type: 'raw', message: '[Rank] Admin: item drop' })
  assert.equal(sent.length, 2)
  assert.equal(sent[0][1].transaction.actions[1].new_item.count, 1)
  assert.match(sent[1][1].command, /^\/msg Admin One-item drop requested/)
})

test('XP replies are private, prefer sidebar data and are rate limited', async t => {
  const { client, sent, advance } = actionSession(t, { settings: { tpa_whitelist: 'Admin' } })
  client.versionGreaterThanOrEqualTo = () => true
  client.emit('spawn')
  client.emit('set_display_objective', { display_slot: 'sidebar', objective_name: 'skyblock' })
  client.emit('set_score', { entries: [{ entry_type: 'fake_player', scoreboard_id: 1n, objective_name: 'skyblock', custom_name: 'Experience: 872.23K' }] })
  client.emit('text', { type: 'raw', message: 'Admin whispers to you: xp?' })
  assert.equal(sent[0][1].command, '/msg Admin 872.23K XP')
  client.emit('text', { type: 'raw', message: 'Admin whispers to you: xp?' })
  assert.equal(sent.length, 1)
  advance(); advance(); advance()
  client.emit('remove_objective', { objective_name: 'skyblock' })
  client.emit('update_attributes', { runtime_entity_id: 12345n, attributes: [{ name: 'minecraft:player.level', current: 458 }, { name: 'minecraft:player.experience', current: 0 }] })
  client.emit('text', { type: 'raw', message: 'Admin whispers to you: xp' })
  assert.equal(sent[1][1].command, '/msg Admin ~871.73K XP (level 458)')
  advance(); advance(); advance()
  client.emit('text', { type: 'raw', message: 'Admin whispers to you: xp?' })
  assert.equal(sent[2][1].command, '/msg Admin ~871.73K XP (level 458)')
})


test('help is complete for long names and management commands are queued once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sender = '.' + 'A'.repeat(32)
  const { root, client, sent, advance } = actionSession(t, { settings: { tpa_whitelist: sender } })
  client.emit('spawn')
  client.emit('text', { type: 'whisper', source_name: sender, message: 'help' })
  assert.equal(sent.length, 1)
  t.mock.timers.tick(1249); assert.equal(sent.length, 1)
  t.mock.timers.tick(1); assert.equal(sent.length, 2)
  t.mock.timers.tick(1250); t.mock.timers.tick(1250)
  t.mock.timers.reset()
  const help = sent.map(([, packet]) => packet.command)
  assert.equal(help.length, 4, 'each help section must arrive')
  assert.ok(help.every(line => line.length <= 100 && line.startsWith(`/msg ${sender} `)))
  assert.match(help.join(' '), /restart/)
  assert.match(help[0], /\[Help 1\/4\] Items: use xp \| item use \| item drop/ )
  assert.match(help[2], /Access: whitelist add\/remove NAME/)
  advance(); advance(); advance()
  const command = message => client.emit('text', { type: 'whisper', source_name: sender, message })
  command('whitelist add NewPlayer')
  command('whitelist add NewPlayer')
  const folder = path.join(root, 'chat-requests')
  let files = fs.readdirSync(folder)
  assert.equal(files.length, 1)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, files[0]))), {
    sender, operation: 'add', target: 'newplayer', created: JSON.parse(fs.readFileSync(path.join(folder, files[0]))).created
  })
  advance(); command('restart')
  files = fs.readdirSync(folder)
  assert.equal(files.length, 2)
  assert.ok(files.some(file => JSON.parse(fs.readFileSync(path.join(folder, file))).operation === 'restart'))
  // A backlog and a filesystem error must produce feedback, never kill the client.
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(folder, `${i}.json`), '{}')
  advance(); command('whitelist remove NewPlayer')
  assert.match(sent.at(-1)[1].command, /Command queue is full/)
  fs.rmSync(folder, { recursive: true }); fs.writeFileSync(folder, 'blocked')
  advance(); command('restart')
  assert.match(sent.at(-1)[1].command, /Could not queue the command/)
})

test('attributed spoofing is rejected and item refusals are sent privately', async t => {
  const { client, sent } = actionSession(t, { settings: { tpa_whitelist: 'Admin' } })
  client.emit('spawn')
  client.emit('text', { type: 'chat', source_name: 'Evil', message: 'Admin: item drop' })
  assert.equal(sent.length, 0)
  client.emit('text', { type: 'chat', source_name: 'Admin', message: 'item drop' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0][0], 'command_request')
  assert.match(sent[0][1].command, /^\/msg Admin Waiting for server inventory data/)
})


test('non-consuming item use refreshes its snapshot and can be used again', async t => {
  const { client, session, sent, item, refresh, select, advance } = actionSession(t)
  client.emit('spawn'); select(); refresh(item)
  client.emit('move_player', { runtime_id: 12345n, position: { x: 1, y: 2, z: 3 } })
  session.useItem()
  await new Promise(resolve => setTimeout(resolve, 350))
  assert.equal(sent.filter(([name]) => name === 'interact').length, 1)
  client.emit('container_open', { window_id: 'inventory', window_type: 'inventory' })
  client.emit('inventory_content', { window_id: 'inventory', input: [{ network_id: 0 }, { network_id: 0 }, item] })
  advance(); session.useItem()
  assert.equal(sent.filter(([name]) => name === 'inventory_transaction').length, 2)
})


test('Complex help has complete numbered sections and no actionable command fragments', async t => {
  const { client, sent, root } = actionSession(t, { settings: { tpa_whitelist: 'JLorenzoo' } })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  client.emit('spawn')
  const help = () => client.emit('text', { type: 'raw', message: '§7Skyblock §8[§cPharaoh+§8] §cJLorenzoo §f➜ §dYou§7: §dhelp' })
  help(); help()
  assert.equal(sent.length, 1)
  t.mock.timers.tick(1250); t.mock.timers.tick(1250); t.mock.timers.tick(1250)
  t.mock.timers.reset()
  assert.deepEqual(sent.map(([, packet]) => packet.command), [
    '/msg JLorenzoo [Help 1/4] Items: use xp | item use | item drop',
    '/msg JLorenzoo [Help 2/4] xp? | help | PM !command args',
    '/msg JLorenzoo [Help 3/4] Access: whitelist add/remove NAME',
    '/msg JLorenzoo [Help 4/4] Client: restart (this alt only)'
  ])
  for (const [, packet] of sent) {
    const body = packet.command.replace('/msg JLorenzoo ', '')
    assert.equal(require('./chat-controls').parseCommand({ type: 'whisper', source_name: 'AnotherAlt', message: body }, 'Receiver'), null)
  }
  assert.equal(fs.existsSync(path.join(root, 'chat-requests')), false)
})

test('disconnect cancels the remaining help sections', async t => {
  const { client, session, sent } = actionSession(t, { settings: { tpa_whitelist: 'Admin' } })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  client.emit('spawn'); client.emit('text', { type: 'whisper', source_name: 'Admin', message: 'help' })
  assert.equal(sent.length, 1)
  session.finish('private test disconnect', 0)
  t.mock.timers.tick(10000)
  assert.equal(sent.length, 1)
  t.mock.timers.reset()
})

test('incoming game packets refresh health even when the periodic timer is delayed', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 20000 })
  const { root, client } = actionSession(t)
  try {
    client.emit('spawn')
    const status = () => JSON.parse(fs.readFileSync(path.join(root, 'bedrock/status.json')))
    assert.equal(status().updated, 20)
    t.mock.timers.setTime(26000)
    client.emit('packet', {})
    assert.equal(status().updated, 26)
    assert.equal(status().connected, true)
    t.mock.timers.setTime(32000)
    client.emit('alt-pilot-network-activity')
    assert.equal(status().updated, 32)
    client.emit('close')
    t.mock.timers.setTime(38000)
    client.emit('packet', {})
    assert.equal(status().connected, false)
  } finally { t.mock.timers.reset() }
})

test('NetherNet XP replies write directly rather than waiting on the batching timer', t => {
  const { client } = actionSession(t, { settings: { tpa_whitelist: 'Admin' } })
  const written = []
  client.options.transport = 'nethernet'
  client.write = (name, params) => written.push({ name, params })
  client.queue = () => { throw new Error('must not wait on the batching timer') }
  client.emit('spawn')
  client.emit('text', { type: 'whisper', source_name: 'Admin', message: 'xp?' })
  assert.equal(written.length, 1)
  assert.equal(written[0].name, 'command_request')
  assert.match(written[0].params.command, /^\/msg Admin .*XP/i)
})

test('private bang commands require whitelist, send once, and bypass local actions', t => {
  const { client, sent, advance } = actionSession(t, { settings: { tpa_whitelist: 'Admin' } })
  client.emit('spawn')
  const whisper = (source_name, message) => client.emit('text', { type: 'whisper', source_name, message })
  whisper('Evil', '!pay JLorenzoo 1')
  client.emit('text', { type: 'chat', source_name: 'Admin', message: '!pay JLorenzoo 1' })
  assert.equal(sent.length, 0)
  whisper('Admin', '!pay JLorenzoo 1')
  whisper('Admin', '!pay JLorenzoo 1')
  assert.deepEqual(sent.filter(([name]) => name === 'command_request').map(([, packet]) => packet.command), ['/pay JLorenzoo 1', '/msg Admin Command sent to the server.'])
  advance(); advance(); advance()
  whisper('Admin', '!help')
  assert.equal(sent[2][1].command, '/help')
  advance(); advance(); advance()
  whisper('Admin', '!item drop')
  assert.equal(sent[4][0], 'command_request')
  assert.equal(sent[4][1].command, '/item drop')
})
