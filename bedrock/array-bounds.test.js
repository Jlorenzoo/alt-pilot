'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { patchArrayReads } = require('./patch-nethernet')
patchArrayReads(require.resolve('protodef/src/datatypes/compiler-structures'))
const { ProtoDefCompiler } = require('protodef').Compiler
function reader (type) {
  const compiler = new ProtoDefCompiler()
  compiler.addTypes({ Read: { slice16: ['native', (buffer, offset) => ({ value: buffer.subarray(offset, offset + 16), size: 16 })] }, Write: {}, SizeOf: {} })
  compiler.addTypesToCompile({ rows: ['array', { countType: 'varint', type }] })
  return compiler.compileProtoDefSync()
}
test('truncated slice arrays cannot turn a tiny packet into millions of allocations', () => {
  const proto = reader('slice16')
  // Count 0xffffff, no payload. Slice-based readers used to return size=16
  // without checking EOF, pushing 16 million empty elements.
  assert.throws(() => proto.read(Buffer.from([255, 255, 255, 7]), 0, 'rows'), /packet bounds/)
})
test('zero-progress array elements stop immediately instead of filling memory', () => {
  const proto = reader('void')
  assert.throws(() => proto.read(Buffer.from([255, 255, 255, 7]), 0, 'rows'), /packet bounds/)
})
test('valid arrays and empty arrays retain their values and byte counts', () => {
  const proto = reader('u8')
  assert.deepEqual(proto.read(Buffer.from([3, 1, 2, 3]), 0, 'rows'), { value: [1, 2, 3], size: 4 })
  assert.deepEqual(proto.read(Buffer.from([0]), 0, 'rows'), { value: [], size: 1 })
})
test('array read patch is idempotent and refuses unknown upstream sources', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'array-bounds-'))
  try {
    const file = path.join(folder, 'reader.js')
    fs.copyFileSync(require.resolve('protodef/src/datatypes/compiler-structures'), file)
    const before = fs.readFileSync(file, 'utf8'); patchArrayReads(file)
    assert.equal(fs.readFileSync(file, 'utf8'), before)
    fs.writeFileSync(file, '// unknown implementation')
    assert.throws(() => patchArrayReads(file), /needs review/)
  } finally { fs.rmSync(folder, { recursive: true }) }
})

test('a running compiled decoder upgrades its reader and preserves variables and writer', () => {
  const { createDeserializer, createSerializer } = require('bedrock-protocol/src/transforms/serializer')
  const parser = createDeserializer('1.26.51'), writer = createSerializer('1.26.51')
  const oldRead = parser.proto.readCtx, oldWrite = parser.proto.writeCtx
  parser.proto.setVariable('ShieldItemID', 123)
  require('./decoder-guard').installReadBounds('1.26.51')
  const params = { timestamp: 123n, needs_response: true }
  const wire = writer.createPacketBuffer({ name: 'network_stack_latency', params })
  const first = parser.parsePacketBuffer(wire)
  assert.equal(first.data.name, 'network_stack_latency')
  assert.equal(String(first.data.params.timestamp), '123')
  assert.notEqual(parser.proto.readCtx, oldRead)
  assert.equal(parser.proto.readCtx.ShieldItemID, 123)
  assert.equal(parser.proto.writeCtx, oldWrite)
  const upgraded = parser.proto.readCtx
  parser.parsePacketBuffer(wire)
  assert.equal(parser.proto.readCtx, upgraded, 'reader is upgraded once')
})
