'use strict'

// Upgrade an already compiled reader without replacing the socket, login,
// inventory handlers or writer. New processes get the same array bounds from
// patch-nethernet.js during installation.
function installReadBounds (version) {
  const structuresFile = require.resolve('protodef/src/datatypes/compiler-structures')
  const oldStructures = require(structuresFile)
  delete require.cache[structuresFile]
  const boundedStructures = require(structuresFile)
  Object.assign(oldStructures.Read, boundedStructures.Read)
  const { CompiledProtodef } = require('protodef').Compiler
  if (CompiledProtodef.prototype.altPilotReadBounds) return
  const original = CompiledProtodef.prototype.read
  CompiledProtodef.prototype.read = function (buffer, cursor, type) {
    if (type === 'mcpe_packet' && !this.altPilotBoundedReader) {
      const { createProtocol } = require('bedrock-protocol/src/transforms/serializer')
      const bounded = createProtocol(version)
      for (const [key, value] of Object.entries(this.readCtx)) {
        if (typeof value !== 'function') bounded.readCtx[key] = value
      }
      this.readCtx = bounded.readCtx
      this.altPilotBoundedReader = true
    }
    return original.call(this, buffer, cursor, type)
  }
  CompiledProtodef.prototype.altPilotReadBounds = true
}
module.exports = { installReadBounds }
