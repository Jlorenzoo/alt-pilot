'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const JWT = require('jsonwebtoken')
const { transportOptions } = require('./transport')
const { patchIdentity } = require('./patch-nethernet')

patchIdentity(require.resolve('nethernet/src/signalling/sdpIdentity'))
const { attachIdentity, verifyServerIdentity } = require('nethernet/src/signalling/sdpIdentity')
const keys = () => crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
const sdp = 'v=0\r\na=fingerprint:sha-256 AA:BB:CC:DD\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'
function answer (format, pair = keys()) {
  const cpk = format === 'jwk' ? pair.publicKey.export({ format: 'jwk' })
    : pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const token = JWT.sign({ cpk }, pair.privateKey, { algorithm: 'ES384', expiresIn: 60 })
  return attachIdentity(sdp, { privateKey: pair.privateKey, token })
}

test('Complex uses certificate-verified HTTPS signalling and native WebRTC with a supported codec', () => {
  const options = transportOptions({ host: 'eu.mc-complex.com', port: 19132 })
  assert.equal(options.nethernet.url, 'https://eu.mc-complex.com:19132')
  assert.equal(options.nethernet.webrtcBackend, 'wrtc')
  assert.equal(options.nethernet.signalling, 'http')
  assert.equal(options.transport, 'nethernet')
  assert.ok(require('bedrock-protocol/src/options').Versions[options.version])
  assert.equal(options.nethernet.onServerKey, undefined)
})
test('other servers keep their existing transport and lookalike domains are not special-cased', () => {
  for (const host of ['127.0.0.1', 'example.org', 'mc-complex.com.example.org', 'notmc-complex.com']) {
    assert.deepEqual(transportOptions({ host, port: 19132 }), {})
  }
})
test('real signed server identities accept both Geyser DER SPKI and upstream JWK keys', () => {
  for (const format of ['der', 'jwk']) {
    const result = verifyServerIdentity(answer(format))
    assert.match(result.fingerprint, /^sha256:[0-9a-f]{64}$/)
    assert.equal(result.sdp, sdp)
  }
})
test('changing a DTLS fingerprint rejects the otherwise valid operator identity', () => {
  assert.throws(() => verifyServerIdentity(answer('der').replace('AA:BB:CC:DD', 'AA:BB:CC:EE')), /signature/i)
})
test('missing or duplicated identities are rejected', () => {
  assert.throws(() => verifyServerIdentity(sdp), /Expected one/)
  const signed = answer('der')
  const identity = signed.split('\r\n').find(line => line.startsWith('a=identity:'))
  assert.throws(() => verifyServerIdentity(signed + identity + '\r\n'), /Expected one/)
})
test('operator identity verification rejects the wrong elliptic curve', () => {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const cpk = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const token = JWT.sign({ cpk }, pair.privateKey, { algorithm: 'ES256', expiresIn: 60 })
  const identity = Buffer.from(JSON.stringify({ assertion: JSON.stringify({ token, fingerprints: '' }), idp: { protocol: 'default' } })).toString('base64')
  assert.throws(() => verifyServerIdentity(sdp + 'a=identity:' + identity), /P-384/)
})

for (const disconnect of [false, true]) {
  test(`Skyblock target routes once after spawn and respects disconnect=${disconnect}`, t => {
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
    const { EventEmitter } = require('node:events')
    const { attachSession } = require('./client')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-pilot-route-test-'))
    fs.mkdirSync(path.join(root, 'bedrock'))
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const client = new EventEmitter(), sent = []
    client.queue = (name, params) => sent.push({ name, params })
    client.close = () => {}
    client.versionGreaterThanOrEqualTo = () => true
    const session = attachSession(client, { root, profile: { xuid: '123' }, routeToSkyblock: true, quit: () => {}, log: () => {} })
    try {
      client.emit('spawn'); client.emit('spawn')
      t.mock.timers.tick(19999)
      assert.equal(sent.length, 0)
      if (disconnect) client.emit('close')
      t.mock.timers.tick(1)
      assert.equal(sent.length, disconnect ? 0 : 1)
      if (!disconnect) assert.equal(sent[0].params.command, '/skyblock')
    } finally {
      session.finish('test complete', 0)
      t.mock.timers.reset()
      fs.rmSync(root, { recursive: true })
    }
  })
}
