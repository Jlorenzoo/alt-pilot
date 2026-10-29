'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { configurePassiveDecoding } = require('./passive-decoding')
function client () {
  const c = new EventEmitter(), received = []
  c.options = { version: '1.26.51' }
  c.readPacket = function (packet) { assert.equal(this, c); received.push(packet) }
  configurePassiveDecoding(c)
  return { c, received }
}
test('bulk render updates with pathological counts never enter the expensive array decoder', () => {
  const { c, received } = client()
  let activity = 0
  c.on('alt-pilot-network-activity', () => activity++)
  // Packet 172, xyz=0, count=0xffffff. The old decoder tries millions of
  // BlockUpdate objects, including when their payload is truncated.
  c.readPacket(Buffer.from([0xac, 1, 0, 0, 0, 0xff, 0xff, 0xff, 7]))
  assert.equal(received.length, 0)
  assert.equal(activity, 1)
})
test('chat, inventory, position, XP, disconnect and malformed headers keep the real decoder', () => {
  const { c, received } = client()
  const { createSerializer } = require('bedrock-protocol/src/transforms/serializer')
  const wire = createSerializer('1.26.51')
  const chat = wire.createPacketBuffer({ name: 'text', params: {
    type: 'whisper', category: 'authored', needs_translation: false,
    source_name: 'JLorenzoo', message: 'xp?', xuid: '', platform_chat_id: '', has_filtered_message: false
  } })
  const packets = [chat, Buffer.from([0x31]), Buffer.from([0x12]), Buffer.from([0x1d]), Buffer.from([5]), Buffer.from([0x80])]
  for (const packet of packets) c.readPacket(packet)
  assert.deepEqual(received, packets)
})

test('server latency probes reach the real decoder and receive a reply', () => {
  const { createSerializer, createDeserializer } = require('bedrock-protocol/src/transforms/serializer')
  const { c, received } = client()
  const wire = createSerializer('1.26.51'), reader = createDeserializer('1.26.51')
  const probe = { timestamp: 123456n, needs_response: true }
  const packet = wire.createPacketBuffer({ name: 'network_stack_latency', params: probe })
  c.readPacket(packet)
  assert.equal(received.length, 1, 'keepalive must not be discarded as rendering data')
  const decoded = reader.parsePacketBuffer(received[0]).data
  assert.equal(decoded.name, 'network_stack_latency')
  assert.equal(Boolean(decoded.params.needs_response), true)
  const response = wire.createPacketBuffer({ name: decoded.name, params: { ...decoded.params, needs_response: false } })
  assert.equal(Boolean(reader.parsePacketBuffer(response).data.params.needs_response), false)
})
