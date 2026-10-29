'use strict'

// Complex retired its RakNet listener during the 2026-10-28 Geyser reload.
// Keep the hostname for HTTPS certificate verification; resolving an IP is
// still useful for the older RakNet path on other configured servers.
function transportOptions ({ host, port }) {
  if (!/(^|\.)mc-complex\.com$/i.test(host)) return {}
  return {
    transport: 'nethernet',
    // Geyser accepts this supported codec over NetherNet, including when its
    // advertisement names a newer codec not shipped by minecraft-data yet.
    version: '1.26.51',
    nethernet: {
      signalling: 'http',
      webrtcBackend: 'wrtc',
      url: `https://${host}:${port}`,
      signallingConnectTimeout: 45000
    },
    pingTimeout: 10000,
    connectTimeout: 45000
  }
}

module.exports = { transportOptions }
