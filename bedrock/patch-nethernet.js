'use strict'
// The pinned upstream HTTP implementation accepts JWK operator keys. Geyser
// supplies DER SPKI instead. Import both without weakening signature checks.
const fs = require('node:fs')

function patchIdentity (file) {
  let source = fs.readFileSync(file, 'utf8')
  if (source.includes('// ALT-PILOT: accept DER SPKI and JWK operator keys.')) return
  const original = "  const key = crypto.createPublicKey({ key: claims?.cpk, format: 'jwk' })"
  if (!source.includes(original)) throw new Error('Unexpected NetherNet identity implementation; compatibility patch needs review')
  source = source.replace(original, `  // ALT-PILOT: accept DER SPKI and JWK operator keys.
  const cpk = claims?.cpk
  const key = typeof cpk === 'string'
    ? crypto.createPublicKey({ key: Buffer.from(cpk, 'base64'), format: 'der', type: 'spki' })
    : crypto.createPublicKey({ key: cpk, format: 'jwk' })
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'secp384r1') {
    throw new Error('Nethernet server identity requires an EC P-384 public key')
  }`)
  source = source.replace('JWT.verify(assertion.token, key)', "JWT.verify(assertion.token, key, { algorithms: ['ES384'] })")
    .replace("JWT.verify(parts.join('.'), key)", "JWT.verify(parts.join('.'), key, { algorithms: ['ES384'] })")
  fs.writeFileSync(file, source)
}

function patchNativeEvents (file) {
  let source = fs.readFileSync(file, 'utf8')
  if (source.includes('// ALT-PILOT: bounded native event delivery.')) return
  const original = '  process.nextTick(() => {'
  if (!source.includes(original)) throw new Error('Unexpected native WebRTC event dispatcher; compatibility patch needs review')
  source = source.replace(original, `  // ALT-PILOT: bounded native event delivery.
  require("../../../../native-events").enqueueNativeEvent(() => {`)
  fs.writeFileSync(file, source)
}

function patchDisconnectGrace (file) {
  let source = fs.readFileSync(file, 'utf8')
  if (source.includes('// ALT-PILOT: allow transient ICE disconnections to recover.')) return
  const original = "      if (state === 'closed' || state === 'disconnected' || state === 'failed') {\n        connection.close('disconnected')\n      }"
  if (!source.includes(original)) throw new Error('Unexpected NetherNet connection state handler; compatibility patch needs review')
  source = source.replace(original, `      // ALT-PILOT: allow transient ICE disconnections to recover.
      if (state === 'disconnected') {
        if (!connection.altPilotDisconnectTimer) {
          connection.altPilotDisconnectTimer = setTimeout(() => {
            connection.altPilotDisconnectTimer = null
            if (isCurrent() && rtcConnection.connectionState === 'disconnected') connection.close('disconnected')
          }, 15000)
          connection.altPilotDisconnectTimer.unref?.()
        }
      } else {
        clearTimeout(connection.altPilotDisconnectTimer)
        connection.altPilotDisconnectTimer = null
        if (state === 'closed' || state === 'failed') connection.close(state)
      }`)
  fs.writeFileSync(file, source)
}

function patchArrayReads (file) {
  let source = fs.readFileSync(file, 'utf8')
  if (source.includes('// ALT-PILOT: bound array reads by available packet bytes.')) return
  const original = "      code += '  data.push(elem.value)\\n'"
  if (!source.includes(original)) throw new Error('Unexpected ProtoDef array reader; compatibility patch needs review')
  source = source.replace(original, `      // ALT-PILOT: bound array reads by available packet bytes.
      // Some primitive readers (including UUID slices) do not throw on EOF.
      // A mismatched count must not allocate millions of empty elements.
      code += '  if (!Number.isSafeInteger(elem.size) || elem.size <= 0 || offset + size + elem.size > buffer.length) throw new PartialReadError("Array element exceeds packet bounds")\\n'
` + original)
  fs.writeFileSync(file, source)
}

function patchInflate (file) {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes('chunkSize: 512000') && !source.includes('chunkSize: 16384')) {
    throw new Error('Unexpected Bedrock inflater; compatibility patch needs review')
  }
  // Zlib returns a slice of its output allocation for small packets. A 500 KiB
  // allocation for every tiny encrypted batch creates severe GC/swap pressure.
  // The standard 16 KiB chunk still grows normally for larger world snapshots.
  fs.writeFileSync(file, source.replaceAll('chunkSize: 512000', 'chunkSize: 16384'))
}

if (require.main === module) {
  patchIdentity(require.resolve('nethernet/src/signalling/sdpIdentity'))
  patchNativeEvents(require.resolve('@roamhq/wrtc/lib/eventtarget'))
  patchDisconnectGrace(require.resolve('nethernet/src/client'))
  patchArrayReads(require.resolve('protodef/src/datatypes/compiler-structures'))
  patchInflate(require.resolve('bedrock-protocol/src/transforms/encryption'))
  patchInflate(require.resolve('bedrock-protocol/src/transforms/framer'))
}
module.exports = { patchIdentity, patchNativeEvents, patchInflate, patchDisconnectGrace, patchArrayReads }
