// Exercise the APIs used by parents whose vulnerable dependencies we override.
// No Oracle or Microsoft services are contacted.
const test = require('node:test')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pipeline } = require('node:stream/promises')
const { createServer } = require('node:http')
const { createGunzip } = require('node:zlib')

const cmakeRequire = createRequire(require.resolve('cmake-js/package.json'))
const msalRequire = createRequire(require.resolve('@azure/msal-node'))

test('the MSAL UUID dependency retains its CommonJS API and checks short buffers', () => {
  const uuid = msalRequire('uuid')
  assert.match(uuid.v4(), /^[a-f0-9-]{36}$/)
  assert.equal(uuid.v5('alt-pilot', uuid.v5.DNS), uuid.v5('alt-pilot', uuid.v5.DNS))
  assert.throws(() => uuid.v5('alt-pilot', uuid.v5.DNS, new Uint8Array(1)), RangeError)
  const { PublicClientApplication } = require('@azure/msal-node')
  const app = new PublicClientApplication({ auth: { clientId: '00000000-0000-0000-0000-000000000000' } })
  assert.ok(app.getTokenCache())
})

test('cmake-js can still extract a gzip stream with the patched tar API', async () => {
  const tar = cmakeRequire('tar')
  const root = await mkdtemp(join(tmpdir(), 'alt-pilot-tar-test-'))
  try {
    const input = join(root, 'input'), output = join(root, 'output')
    await mkdir(input); await mkdir(output)
    await writeFile(join(input, 'header.h'), 'verified local fixture')
    await pipeline(tar.create({ cwd: input, gzip: true }, ['header.h']), createGunzip(), tar.extract({ cwd: output }))
    assert.equal(await readFile(join(output, 'header.h'), 'utf8'), 'verified local fixture')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cmake-js retains its axios streaming-download API', async () => {
  const axios = cmakeRequire('axios')
  const server = createServer((request, response) => response.end('local download fixture'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await axios.get(`http://127.0.0.1:${server.address().port}/headers`, { responseType: 'stream', proxy: false })
    const parts = []
    for await (const part of response.data) parts.push(part)
    assert.equal(Buffer.concat(parts).toString(), 'local download fixture')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
