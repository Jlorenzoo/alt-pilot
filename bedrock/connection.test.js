'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const bedrock = require('bedrock-protocol')
const { attachSession } = require('./client')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

test('real RakNet client drops one item, receives inventory confirmation and stays connected', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-pilot-network-test-'))
  fs.mkdirSync(path.join(root, 'bedrock'))
  const port = 21000 + Math.floor(Math.random() * 10000)
  const server = new (require('bedrock-protocol/src/server').Server)({ host: '127.0.0.1', port, version: '1.26.45', offline: true, raknetBackend: 'jsp-raknet', conLog: () => {} })
  let client, session
  try {
    await server.listen()
    const received = new Promise((resolve, reject) => {
      server.on('connect', player => {
        player.on('error', reject)
        player.on('join', () => {
          player.write('play_status', { status: 'player_spawn' })
        })
        const item = { network_id: 250, count: 2, metadata: 0, has_stack_id: false,
          block_runtime_id: 0, extra: { has_nbt: false, can_place_on: [], can_destroy: [] } }
        const inventorySlot = value => player.write('inventory_slot', {
          window_id: 'inventory', slot: 0, container: null, storage_item: null, item: value
        })
        player.on('command_request', packet => {
          if (packet.command === '/home test') inventorySlot(item)
          else if (packet.command === '/home done') resolve(packet.command)
        })
        player.on('inventory_transaction', packet => {
          try {
            assert.equal(packet.transaction.transaction_type, 'normal')
            const [container, world] = packet.transaction.actions
            assert.equal(container.window_id, 0)
            assert.equal(container.container_presence, true)
            assert.equal(container.old_item.count, 2)
            assert.equal(container.new_item.count, 1)
            assert.equal(world.new_item.count, 1)
            assert.equal(world.flag_presence, true)
            assert.equal(world.flags, 0)
            inventorySlot({ ...item, count: 1 })
          } catch (error) { reject(error) }
        })
      })
    })
    client = bedrock.createClient({ host: '127.0.0.1', port, version: '1.26.45', offline: true, raknetBackend: 'jsp-raknet', useRaknetWorkers: false, skipPing: true, username: 'LocalTest', conLog: null })
    session = attachSession(client, { root, profile: { xuid: '0' }, log: () => {}, quit: () => {} })
    client.on('spawn', () => session.send('/home test'))
    client.on('inventory_slot', packet => {
      if (packet.item.count === 2) setTimeout(() => session.dropItem(), 2100)
      else if (packet.item.count === 1) session.send('/home done')
    })
    assert.equal(await Promise.race([received, new Promise((_, reject) => setTimeout(() => reject(new Error('Handshake timed out')), 10000).unref())]), '/home done')
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'bedrock/status.json'))).connected, true)
  } finally {
    session?.finish('Test complete', 0)
    client?.close()
    server.close()
    await new Promise(resolve => setTimeout(resolve, 200))
    fs.rmSync(root, { recursive: true })
  }
})

test('private RakNet chat packets authorize commands, reply and queue management requests', { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-pilot-private-chat-'))
  fs.mkdirSync(path.join(root, 'bedrock'))
  const port = 21000 + Math.floor(Math.random() * 10000)
  const server = new (require('bedrock-protocol/src/server').Server)({ host: '127.0.0.1', port, version: '1.26.45', offline: true, raknetBackend: 'jsp-raknet', conLog: () => {} })
  let client, session, clock = 10000
  try {
    await server.listen()
    const received = new Promise((resolve, reject) => {
      server.on('connect', player => {
        let phase = 'help'
        const helpLines = [
          '[Help 1/4] Items: use xp | item use | item drop',
          '[Help 2/4] xp? | help | PM !command args',
          '[Help 3/4] Access: whitelist add/remove NAME',
          '[Help 4/4] Client: restart (this alt only)'
        ]
        let helpCount = 0, lastHelpAt = 0
        const text = (message, source = 'JLorenzoo') => player.write('text', {
          type: 'whisper', category: 'authored', needs_translation: false,
          source_name: source, message, xuid: '', platform_chat_id: '', has_filtered_message: false
        })
        const request = message => { clock += 6000; text(`Skyblock [Member] JLorenzoo ➜ You: ${message}`) }
        const item = { network_id: 250, count: 3, metadata: 0, has_stack_id: false,
          block_runtime_id: 0, extra: { has_nbt: false, can_place_on: [], can_destroy: [] } }
        const inventory = value => player.write('inventory_slot', { window_id: 'inventory', slot: 0, container: null, storage_item: null, item: value })
        player.on('error', reject)
        player.on('join', () => player.write('play_status', { status: 'player_spawn' }))
        player.on('command_request', packet => {
          try {
            const command = packet.command
            if (command === '/lab ready') {
              // The packet source must agree with the attributed sender.
              text('Skyblock [Member] JLorenzoo ➜ You: item drop', 'Evil')
              player.write('network_stack_latency', { timestamp: 123456n, needs_response: true })
            } else if (phase === 'help') {
              assert.equal(command, '/msg JLorenzoo ' + helpLines[helpCount])
              if (lastHelpAt) assert.ok(Date.now() - lastHelpAt >= 1000, 'help packets must be spaced apart')
              lastHelpAt = Date.now()
              if (++helpCount < helpLines.length) return
              phase = 'xp'
              player.write('set_display_objective', { display_slot: 'sidebar', objective_name: 'lab', display_name: 'Lab', criteria_name: 'dummy', sort_order: 0 })
              player.write('set_score', { entries: [{ entry_type: 'fake_player', entry_type_name: 'fake_player', scoreboard_id: 1n, objective_name: 'lab', score: 1, custom_name: 'Experience: 123K' }] })
              request('xp?')
            } else if (phase === 'xp') {
              assert.equal(command, '/msg JLorenzoo 123K XP')
              phase = 'add'; request('whitelist add LocalUser')
            } else if (['add', 'remove', 'restart'].includes(phase)) {
              assert.match(command, /Request queued/)
              const queued = fs.readdirSync(path.join(root, 'chat-requests')).map(file => JSON.parse(fs.readFileSync(path.join(root, 'chat-requests', file))))
              assert.ok(queued.some(value => value.operation === phase && value.sender === 'JLorenzoo'))
              if (phase === 'add') { phase = 'remove'; request('whitelist remove LocalUser') }
              else if (phase === 'remove') { phase = 'restart'; request('restart') }
              else {
                assert.equal(queued.length, 3)
                phase = 'use'
                inventory(item)
                player.write('move_player', { runtime_id: 1, position: { x: 1, y: 64, z: 2 }, pitch: 0, yaw: 0, head_yaw: 0, mode: 'normal', on_ground: true, ridden_runtime_id: 0, teleport: null, tick: 1n })
                request('item use')
              }
            } else if (phase === 'use') {
              assert.match(command, /Use-item request sent/)
              phase = 'drop'; inventory({ ...item, count: 2 }); request('item drop')
            } else if (phase === 'drop') {
              assert.match(command, /One-item drop requested/)
              phase = 'bang'; request('!pay MixedCase 1')
            } else if (phase === 'bang') {
              assert.equal(command, '/pay MixedCase 1')
              phase = 'bang-reply'
            } else if (phase === 'bang-reply') {
              assert.equal(command, '/msg JLorenzoo Command sent to the server.')
              phase = 'done'; resolve()
            }
          } catch (error) { reject(error) }
        })
        player.on('network_stack_latency', packet => {
          try {
            assert.equal(Boolean(packet.needs_response), false)
            request('hlep')
          } catch (error) { reject(error) }
        })
        player.on('inventory_transaction', packet => {
          try {
            const transaction = packet.transaction
            if (phase === 'use') {
              assert.equal(transaction.transaction_type, 'item_use')
              assert.equal(transaction.transaction_data.held_item.count, 3)
            } else {
              assert.equal(phase, 'drop', 'unauthorized sources must never send actions')
              assert.equal(transaction.transaction_type, 'normal')
              assert.equal(transaction.actions[0].new_item.count, 1)
              assert.equal(transaction.actions[1].new_item.count, 1)
              inventory({ ...item, count: 1 })
            }
          } catch (error) { reject(error) }
        })
      })
    })
    client = bedrock.createClient({ host: '127.0.0.1', port, version: '1.26.45', offline: true, raknetBackend: 'jsp-raknet', useRaknetWorkers: false, skipPing: true, username: 'LocalChatAlt', conLog: null })
    require('./passive-decoding').configurePassiveDecoding(client)
    client.startGameData.runtime_entity_id = 1n
    session = attachSession(client, { root, profile: { name: 'LocalChatAlt', xuid: '0' }, settings: { tpa_whitelist: 'JLorenzoo' }, now: () => clock, log: () => {}, quit: () => {} })
    client.on('spawn', () => session.send('/lab ready'))
    await Promise.race([received, new Promise((_, reject) => setTimeout(() => reject(new Error('Private chat handshake timed out')), 12000).unref())])
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'bedrock/status.json'))).connected, true)
  } finally {
    session?.finish('Private test complete', 0)
    client?.close(); server.close()
    await new Promise(resolve => setTimeout(resolve, 200))
    fs.rmSync(root, { recursive: true })
  }
})
