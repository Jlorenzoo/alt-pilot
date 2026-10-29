'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib')
const { patchInflate } = require('./patch-nethernet')

test('inflater patch preserves small and large payloads with bounded small-packet allocations', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-inflate-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'inflate.cjs')
  fs.writeFileSync(file, 'module.exports = packet => require("node:zlib").inflateRawSync(packet, { chunkSize: 512000 })')
  patchInflate(file); const once = fs.readFileSync(file, 'utf8'); patchInflate(file)
  assert.equal(fs.readFileSync(file, 'utf8'), once)
  const inflate = require(file)
  for (const size of [64, 1048576]) {
    const plain = Buffer.alloc(size, 42), result = inflate(zlib.deflateRawSync(plain))
    assert.deepEqual(result, plain)
    if (size === 64) assert.ok(result.buffer.byteLength <= 65536 && result.buffer.byteLength < 512000)
  }
  fs.writeFileSync(file, 'unexpected upstream')
  assert.throws(() => patchInflate(file), /needs review/)
})
