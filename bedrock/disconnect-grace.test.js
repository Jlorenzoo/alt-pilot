'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { patchDisconnectGrace } = require('./patch-nethernet')

function handler (t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nethernet-grace-'))
  t.after(() => fs.rmSync(folder, { recursive: true }))
  const file = path.join(folder, 'client.js')
  fs.copyFileSync(require.resolve('nethernet/src/client'), file)
  patchDisconnectGrace(file)
  const source = fs.readFileSync(file, 'utf8')
  patchDisconnectGrace(file)
  assert.equal(fs.readFileSync(file, 'utf8'), source, 'patch is idempotent')
  const body = source.split('    rtcConnection.onconnectionstatechange = () => {')[1].split('\n    rtcConnection.oniceconnectionstatechange')[0].trim().replace(/}\s*$/, '')
  const rtc = { connectionState: 'connected' }, closed = []
  const connection = { closed: false, close (reason) { this.closed = true; closed.push(reason) } }
  const notify = new Function('rtcConnection', 'connection', 'isCurrent', 'debug', 'return () => {' + body + '}').call(
    { _hasEmittedConnected: true }, rtc, connection, () => !connection.closed, () => {})
  return { rtc, connection, closed, change (state) { rtc.connectionState = state; notify() } }
}
test('transient WebRTC disconnection recovers without closing or replacing the session', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = handler(t)
  h.change('disconnected')
  t.mock.timers.tick(10000)
  h.change('disconnected')
  h.change('connected')
  t.mock.timers.tick(20000)
  assert.deepEqual(h.closed, [])
  h.change('disconnected')
  t.mock.timers.tick(14999)
  assert.deepEqual(h.closed, [])
  t.mock.timers.tick(1)
  assert.deepEqual(h.closed, ['disconnected'])
})
test('terminal WebRTC failure is handled immediately and stale grace timers cannot close another session', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = handler(t)
  h.change('disconnected'); h.change('failed')
  assert.deepEqual(h.closed, ['failed'])
  t.mock.timers.tick(20000)
  assert.deepEqual(h.closed, ['failed'])
})
test('disconnect patch refuses unknown upstream code', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nethernet-unknown-'))
  t.after(() => fs.rmSync(folder, { recursive: true }))
  const file = path.join(folder, 'client.js'); fs.writeFileSync(file, '// changed upstream')
  assert.throws(() => patchDisconnectGrace(file), /needs review/)
})
