'use strict'
// Passive Bedrock client: authenticate, remain connected, and relay user input.
// No mining or anti-AFK movement; inventory actions require explicit user input.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const readline = require('node:readline')
const net = require('node:net')
const dns = require('node:dns/promises')
const { Authflow, Titles } = require('prismarine-auth')
const chatControls = require('./chat-controls')
const { transportOptions } = require('./transport')
const { configurePassiveDecoding } = require('./passive-decoding')

// Nintendo Switch is the standard client ID supported by prismarine-auth and bedrock-protocol for live SSO device code auth.
const PLATFORM = { authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo' }
function sessionAuthOptions () {
  return { ...PLATFORM, flow: 'live', deviceOS: 12 }
}
function atomicJson (file, value, mode = 0o644) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value), { mode })
  try { fs.chmodSync(file + '.tmp', mode) } catch {}
  fs.renameSync(file + '.tmp', file)
}
function profileFromChain (chain) {
  for (const token of chain || []) {
    const data = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).extraData
    if (data?.displayName && data?.identity && /^[1-9][0-9]*$/.test(String(data.XUID))) {
      return { name: data.displayName, uuid: data.identity, xuid: String(data.XUID) }
    }
  }
  throw new Error('Microsoft did not return a Bedrock gamer profile. Complete Xbox account setup and try again.')
}
function safeError (error) {
  return String(error?.message || error).replace(/eyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/g, '[token removed]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email removed]').slice(0, 1500)
}
function bedrockLicenseError (text) {
  return /"error"\s*:\s*"UNAUTHORIZED"|does not own Minecraft Bedrock|Bedrock multiplayer entitlement/i.test(String(text || ''))
}
function bedrockLicenseMessage () {
  return 'Mojang rejected Bedrock multiplayer for this Microsoft account (UNAUTHORIZED). Seeing Java and Bedrock on minecraft.com is a different check. Launch Bedrock once on Xbox, Windows, Android, or iOS with the same account used at microsoft.com/link, then retry. A PlayStation or Nintendo purchase, and some Game Pass licenses, can show Bedrock on the website and still fail here. If you play Java on Complex (name without a leading dot), sign in as Java instead.'
}
function endpoint (server = 'eu.mc-complex.com') {
  // The configured Java-specific Skyblock endpoint is not a Bedrock endpoint.
  const host = server.split(':')[0]
  return { host: host === 'skyblock.mc-complex.com' ? 'eu.mc-complex.com' : host, port: 19132 }
}
async function resolveHost (host) {
  if (!host || net.isIP(host)) return host
  try {
    const { address } = await dns.lookup(host, { family: 4 })
    if (address) return address
  } catch {}
  return host
}
function isPacketReadError (error) {
  if (!error) return false
  const msg = String(error.message || error)
  return Boolean(
    error.field ||
    error.name === 'PartialReadError' ||
    /Read error|PartialReadError|Invalid tag|Read failure/i.test(msg)
  )
}
async function login (root) {
  const folder = path.join(root, 'bedrock')
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
  const onCode = data => {
    console.log(`Open ${data.verification_uri || 'https://www.microsoft.com/link'} and enter code: ${data.user_code}`)
    console.log('After Microsoft approves, keep this dialog open while Xbox validates your Bedrock profile.')
  }
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
  const publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const platform = PLATFORM
  const flow = new Authflow('alt-pilot', folder, { ...platform, flow: 'live' }, onCode)
  let result
  try {
    result = await flow.getMinecraftBedrockToken(publicKeyB64)
  } catch (error) {
    if (bedrockLicenseError(safeError(error))) throw new Error(bedrockLicenseMessage())
    throw error
  }
  const profile = { ...profileFromChain(result.chain), authTitle: platform.authTitle, deviceType: platform.deviceType }
  atomicJson(path.join(folder, 'profile.json'), profile)
  console.log(`Bedrock profile verified: ${profile.name}`)
}
function attachSession (client, { root, profile, settings = {}, log = console.log, quit = process.exit, now = Date.now, dropEnabled = true, routeToSkyblock = false }) {
  try { fs.chmodSync(path.join(root, 'bedrock'), 0o755) } catch {}
  const stateFile = path.join(root, 'bedrock/status.json')
  let spawned = false
  let initialRouteScheduled = false
  let closing = false
  let lastPacket = Date.now()
  const timers = new Set()
  const schedule = (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); if (!closing && spawned) fn() }, ms); timers.add(timer) }
  let lastStatusWrite = 0
  let lastHealthCheck = Date.now()
  const state = (connected, reason = '') => {
    lastStatusWrite = Date.now()
    const memory = process.memoryUsage()
    atomicJson(stateFile, { pid: process.pid, connected, updated: lastStatusWrite / 1000, last_packet: lastPacket / 1000, memory: { rss: memory.rss, heap: memory.heapUsed, external: memory.external, buffers: memory.arrayBuffers }, reason })
  }
  state(false, 'Connecting')
  function finish (reason, code = 1) {
    if (closing) return
    closing = true
    spawned = false
    for (const timer of timers) clearTimeout(timer)
    clearInterval(health)
    clearInterval(keepAlive)
    state(false, safeError(reason))
    log(`[ALT-PILOT] ${safeError(reason)}`)
    try { client.close() } catch {}
    if (typeof client.on === 'function') client.on('error', () => {})
    setTimeout(() => quit(code), 100)
  }
  const health = setInterval(() => {
    const lag = Date.now() - lastHealthCheck - 10000
    lastHealthCheck = Date.now()
    if (lag > 2000) log(`[ALT-PILOT] Client event loop delayed ${Math.round(lag)}ms; last network activity ${Math.round((Date.now() - lastPacket) / 1000)}s ago.`)
    if (Date.now() - lastPacket > 300000) return finish('Bedrock connection stopped responding; reconnecting.')
    state(spawned)
  }, 10000)
  if (typeof health.unref === 'function') health.unref()
  const keepAlive = setInterval(() => {
    if (spawned && !closing) {
      try {
        const sendPacket = client.options?.transport === 'nethernet' && typeof client.write === 'function' ? client.write.bind(client) : client.queue.bind(client)
        sendPacket('tick_sync', { request_time: BigInt(Date.now()), response_time: 0n })
      } catch {}
    }
  }, 15000)
  if (typeof keepAlive.unref === 'function') keepAlive.unref()
  timers.add(keepAlive)
  let currentPos = null
  const emptyItem = () => ({ network_id: 0, count: 0, metadata: 0,
    has_stack_id: false, block_runtime_id: 0,
    extra: { has_nbt: false, can_place_on: [], can_destroy: [] } })
  const inventory = new Map()
  let heldSlot = 0
  let holdInventory = null
  let pendingHold = null
  let holdRequestId = 0
  let xpBottleId = null
  let stackRequests = true
  let pendingDrop = null
  let pendingUseSlot = null
  let inventoryRefresh = null
  let lastActionAt = -Infinity
  let containerOpen = false
  let routePending = false
  let routeTimer = null
  function setRoutePending (pending) {
    routePending = pending
    if (routeTimer) {
      clearTimeout(routeTimer)
      timers.delete(routeTimer)
      routeTimer = null
    }
    if (pending) {
      routeTimer = setTimeout(() => {
        if (routePending) {
          routePending = false
          log('[ALT-PILOT] Server route wait timed out after 15s; clearing route lock.')
          requestInventoryRefresh()
        }
      }, 15000)
      if (typeof routeTimer.unref === 'function') routeTimer.unref()
      timers.add(routeTimer)
    }
  }
  const mainInventory = id => id === 'inventory' || id === 0 || id === 'hotbar' || id === 122
  function resetInventory () {
    inventory.clear()
    // Do not guess inventory across dimension changes, respawns or server routes.
    holdInventory = null
    pendingHold = null
    pendingDrop = null
    pendingUseSlot = null
    inventoryRefresh = null
    setRoutePending(false)
    containerOpen = false
    lastActionAt = now()
  }
  function selectSlot (slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 8) return false
    const item = inventory.get(slot)
    if (!item || !client.entityId) {
      log('[ALT-PILOT] Cannot select an unknown inventory slot or player identity.')
      return false
    }
    try {
      // PlayerHotbar is SERVER -> CLIENT only. Sending it upstream can cause
      // Geyser to close the connection. MobEquipment selects the held slot.
      // Geyser's modern equipment descriptor has an extra net-ID variant byte
      // that our dependency omits. Equipment does not require a net ID: send
      // the valid optional-ID-absent form, preserving the actual item snapshot.
      const equipmentItem = { ...item, has_stack_id: typeof item.has_stack_id === 'number' ? 0 : false }
      delete equipmentItem.stack_id
      client.queue('mob_equipment', {
        runtime_entity_id: client.entityId,
        item: equipmentItem,
        slot,
        selected_slot: slot,
        window_id: 'inventory'
      })
    } catch (error) {
      log(`[ALT-PILOT] Could not select hotbar slot: ${safeError(error)}`)
      return false
    }
    heldSlot = slot
    log(`[ALT-PILOT] Selected hotbar slot ${slot + 1} (slot index ${slot}, item=${item.network_id}, count=${item.count ?? 0}).`)
    return true
  }
  let actionFailure = ''
  function actionItem (chained = false) {
    actionFailure = ''
    if (!spawned || closing) return null
    let reason
    const item = inventory.get(heldSlot)
    if (routePending) reason = 'Waiting for the server route to finish; no packet was sent.'
    else if (containerOpen) reason = 'Close the open inventory menu first.'
    else if (pendingHold) reason = 'Waiting for the server to confirm the XP bottle move.'
    else if (pendingUseSlot !== null) reason = 'Waiting for server inventory data after item use.'
    else if (pendingDrop) reason = 'Waiting for the server to update the dropped slot; no retry was sent.'
    else if (!chained && now() - lastActionAt < 2000) reason = 'Wait 2 seconds between item actions.'
    else if (!item) reason = 'Waiting for server inventory data; no packet was sent.'
    else if (!Number.isInteger(item.network_id) || item.network_id === 0 ||
      !Number.isInteger(item.count) || item.count < 1 || item.count > 255) reason = 'The selected slot is empty or invalid; no packet was sent.'
    else if (!item.extra || !Number.isInteger(item.metadata) || !Number.isInteger(item.block_runtime_id)) reason = 'Incomplete item data; no packet was sent.'
    if (reason) { actionFailure = reason; log(`[ALT-PILOT] Item action blocked: ${reason}`); return null }
    return item
  }
  function updateSlot (slot, item) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 35) return
    if (!item || !Number.isInteger(item.network_id)) { inventory.delete(slot); return }
    inventory.set(slot, item)
    if (pendingUseSlot === slot) pendingUseSlot = null
    if (pendingDrop?.slot === slot) {
      const expected = pendingDrop.expected
      const matches = item.network_id === expected.network_id &&
        (expected.network_id === 0 || (item.count === expected.count && item.metadata === expected.metadata))
      log(matches ? '[ALT-PILOT] Server inventory matches the requested one-item drop.'
        : '[ALT-PILOT] Server resynchronized the dropped slot; drop was not confirmed. No retry was sent.')
      pendingDrop = null
    }
  }

  function closeInventoryRefresh () {
    const refresh = inventoryRefresh
    if (!refresh?.opened || !refresh.snapshot) return
    try {
      client.queue('container_close', { window_id: 'inventory', window_type: refresh.windowType, server: false })
      inventoryRefresh = null
      containerOpen = false
    } catch (error) {
      log(`[ALT-PILOT] Could not close inventory refresh: ${safeError(error)}`)
    }
  }

  function requestInventoryRefresh () {
    if (containerOpen || inventoryRefresh) return
    inventoryRefresh = { opened: false, snapshot: false, windowType: null }
    try {
      client.queue('interact', { action_id: 'open_inventory', target_entity_id: client.entityId, has_position: false })
    } catch (error) {
      inventoryRefresh = null
      log(`[ALT-PILOT] Could not refresh inventory: ${safeError(error)}`)
    }
  }

  function useItem (targetSlot = null, chained = false) {
    if (targetSlot !== null && Number.isInteger(targetSlot) && targetSlot >= 0 && targetSlot <= 8) {
      if (!selectSlot(targetSlot)) return 'Could not select the requested hotbar slot; no item action was sent.'
    }
    const heldItem = actionItem(chained)
    if (!heldItem) return actionFailure || 'The alt is not connected.'
    const pos = currentPos
    if (!pos || !['x', 'y', 'z'].every(axis => Number.isFinite(pos[axis]))) {
      log('[ALT-PILOT] Item action blocked: Waiting for the player position.')
      return 'Waiting for the player position.'
    }
    try {
      client.queue('inventory_transaction', {
        transaction: {
          legacy: { legacy_request_id: 0 },
          actions: [],
          transaction_type: 'item_use',
          transaction_data: {
            action_type: 'click_air',
            trigger_type: 'player_input',
            client_prediction: 'failure',
            client_cooldown_state: 'off',
            block_position: { x: 0, y: 0, z: 0 },
            face: 0,
            hotbar_slot: heldSlot,
            held_item: heldItem,
            player_pos: pos,
            click_pos: pos,
            block_runtime_id: 0
          }
        }
      })
      lastActionAt = now()
      inventory.delete(heldSlot) // Consumption must be followed by fresh server data.
      const usedSlot = pendingUseSlot = heldSlot
      // Non-consuming right-clicks need not echo a slot update. Request the
      // authoritative inventory once instead of permanently blocking item use.
      schedule(() => { if (pendingUseSlot === usedSlot) requestInventoryRefresh() }, 300)
      log('[ALT-PILOT] Use-item request sent; waiting for server inventory data.')
      return 'Use-item request sent.'
    } catch (err) {
      log(`[ALT-PILOT] Could not use item: ${safeError(err)}`)
      return 'Could not send the item action.'
    }
  }

  function dropItem (targetSlot = null) {
    if (!dropEnabled) {
      log('[ALT-PILOT] Item dropping is disabled for this session. No packet was sent.')
      return 'Item dropping is disabled for this session.'
    }
    if (targetSlot !== null && Number.isInteger(targetSlot) && targetSlot >= 0 && targetSlot <= 8) {
      if (!selectSlot(targetSlot)) return 'Could not select the requested hotbar slot; no item action was sent.'
    }
    const heldItem = actionItem()
    if (!heldItem) return actionFailure || 'The alt is not connected.'
    // One click drops one item. Preserve NBT, metadata and the remaining stack ID.
    const remaining = heldItem.count === 1 ? emptyItem() : { ...heldItem, count: heldItem.count - 1 }
    const dropped = { ...heldItem, count: 1, has_stack_id: typeof heldItem.has_stack_id === 'number' ? 0 : false }
    delete dropped.stack_id
    try {
      client.queue('inventory_transaction', {
        transaction: {
          legacy: { legacy_request_id: 0 },
          transaction_type: 'normal',
          actions: [
            {
              source_type: 'container',
              inventory_id: 'inventory', // Legacy protocol format.
              // Modern source fields have an outer presence bit AND an optional
              // value bit. Keep the outer bit true even when the value is null,
              // matching Cloudburst InventoryTransactionSerializer_v1001.
              container_presence: true, window_id: 0, flag_presence: true, flags: null,
              slot: heldSlot, old_item: heldItem, new_item: remaining
            },
            {
              source_type: 'world_interaction',
              container_presence: true, window_id: null, flag_presence: true, flags: 0,
              slot: 0, old_item: emptyItem(), new_item: dropped
            }
          ]
        }
      })
      lastActionAt = now()
      const pending = pendingDrop = { slot: heldSlot, expected: remaining }
      log('[ALT-PILOT] One-item drop request sent; awaiting server inventory update.')
      // Geyser predicts a normal drop and need not echo InventorySlot. Opening
      // the player's inventory requests a fresh authoritative snapshot; it does
      // not repeat the drop. Close only the inventory we opened ourselves.
      schedule(() => {
        if (pendingDrop !== pending || containerOpen) return
        requestInventoryRefresh()
      }, 300)
      schedule(() => {
        if (pendingDrop === pending) log('[ALT-PILOT] Drop remains unconfirmed. Further item actions are blocked until the server refreshes inventory; no retry was sent.')
      }, 5000)
      return 'One-item drop requested; waiting for server confirmation.'
    } catch (err) {
      // A serialization failure must not be followed by a fallback action packet.
      inventory.delete(heldSlot)
      log(`[ALT-PILOT] Could not drop item: ${safeError(err)}`)
      return 'Could not send the item action.'
    }
  }

  // Resolve the runtime item ID from the server palette, never a version-specific number.
  function readItemPalette (packet) {
    const bottle = packet?.itemstates?.find(item => item.name === 'minecraft:experience_bottle')
    if (bottle && Number.isInteger(bottle.runtime_id)) xpBottleId = bottle.runtime_id
  }
  client.on('start_game', packet => {
    xpBottleId = null
    readItemPalette(packet)
    stackRequests = packet.item_stack_net_manager_enabled !== false
  })
  client.on('item_registry', readItemPalette)
  const sameStack = (a, b) => a?.network_id === b?.network_id && (a?.count || 0) === (b?.count || 0) &&
    (a?.network_id === 0 || a?.stack_id === b?.stack_id)
  function closeHoldInventory (move) {
    if (move?.menu) move.menu.complete = true
    if (!holdInventory?.complete || !holdInventory.opened) return
    try {
      client.queue('container_close', { window_id: 'inventory', window_type: holdInventory.windowType, server: false })
      holdInventory = null
      containerOpen = false
    } catch (error) { log(`[ALT-PILOT] Could not close XP inventory: ${safeError(error)}`) }
  }
  function confirmHoldSnapshot () {
    const move = pendingHold
    if (!move || !sameStack(inventory.get(move.destination), move.bottle) ||
        !sameStack(inventory.get(move.source), move.previous)) return
    completeHold(move)
  }
  function completeHold (move) {
    closeHoldInventory(move)
    pendingHold = null
    const selected = selectSlot(move.destination)
    if (move.useAfter) {
      const allowed = !move.sender || chatControls.whitelisted(move.sender, loadSettings(true).tpa_whitelist)
      const result = !allowed ? 'XP use cancelled: whitelist access changed.'
        : selected ? useItem(null, true) : 'Could not select the XP bottle; no use was sent.'
      log('[ALT-PILOT] ' + result)
      if (move.sender) reply(move.sender, result)
    } else log(selected ? '[ALT-PILOT] Server confirmed XP bottle equipped.' : '[ALT-PILOT] XP bottle moved, but hotbar selection failed.')
  }
  function holdXP (useAfter = false, sender = null) {
    let reason
    if (!spawned || closing) reason = 'The alt is not connected.'
    else if (routePending) reason = 'Waiting for the server route to finish.'
    else if (containerOpen || inventoryRefresh) reason = 'Close the open inventory menu first, or wait for its refresh.'
    else if (pendingHold || pendingDrop || pendingUseSlot !== null) reason = 'Waiting for the server to confirm the previous inventory action.'
    else if (now() - lastActionAt < 2000) reason = 'Wait 2 seconds between item actions.'
    else if (xpBottleId === null) reason = 'XP bottle item ID is unavailable until the server sends its item palette.'
    if (reason) { log(`[ALT-PILOT] ${reason}`); return reason }
    const slots = [...inventory.keys()].sort((a, b) => a - b)
    const source = slots.find(slot => inventory.get(slot)?.network_id === xpBottleId && inventory.get(slot).count > 0)
    if (source === undefined) {
      requestInventoryRefresh()
      return 'No XP bottle found in the known inventory. Refresh requested; try again shortly.'
    }
    lastActionAt = now()
    if (source < 9) {
      if (!selectSlot(source)) return 'Could not select the XP bottle.'
      return useAfter ? useItem(null, true) : 'Selected the XP bottle in the hotbar.'
    }
    // Prefer an empty known slot; otherwise preserve the held stack by swapping it.
    const destination = slots.find(slot => slot < 9 && inventory.get(slot)?.network_id === 0) ?? heldSlot
    const bottle = inventory.get(source)
    const previous = inventory.get(destination)
    if (!previous) { requestInventoryRefresh(); return 'Hotbar data is unknown. Refresh requested; try again shortly.' }
    if (stackRequests && (!bottle.has_stack_id || !Number.isInteger(bottle.stack_id) ||
        (previous.network_id !== 0 && (!previous.has_stack_id || !Number.isInteger(previous.stack_id))))) {
      requestInventoryRefresh()
      return 'Item stack IDs are unavailable. Refresh requested; no move was sent.'
    }
    const move = { source, destination, useAfter, sender, bottle: structuredClone(bottle), previous: structuredClone(previous), requestId: ++holdRequestId }
    pendingHold = move
    try {
      if (stackRequests) {
        // Geyser establishes the player inventory handler on open_inventory.
        // Opening and requesting in queue order avoids silently ignored swaps.
        move.menu = holdInventory = { opened: false, complete: false, windowType: null }
        client.queue('interact', { action_id: 'open_inventory', target_entity_id: client.entityId, has_position: false })
        const slotInfo = (slot, item) => ({ slot_type: { container_id: 'hotbar_and_inventory', dynamic_container_id: null }, slot,
          stack_id: item.network_id === 0 ? 0 : item.stack_id })
        client.queue('item_stack_request', { requests: [{ request_id: move.requestId, actions: [{ type_id: 'swap',
          source: slotInfo(source, bottle), destination: slotInfo(destination, previous) }], custom_names: [], cause: -1 }] })
      } else {
        const action = (slot, oldItem, newItem) => ({ source_type: 'container', inventory_id: 'inventory',
          container_presence: true, window_id: 0, flag_presence: true, flags: null,
          slot, old_item: oldItem, new_item: newItem })
        client.queue('inventory_transaction', { transaction: { legacy: { legacy_request_id: 0 }, transaction_type: 'normal',
          actions: [action(source, bottle, previous), action(destination, previous, bottle)] } })
      }
      schedule(() => {
        if (pendingHold !== move) return
        if (move.useAfter && move.sender) reply(move.sender, 'XP move timed out; no use was sent. Try again after inventory refresh.')
        move.useAfter = false
        log('[ALT-PILOT] XP bottle move is unconfirmed; requesting inventory, without retrying the move.')
        closeHoldInventory(move)
        requestInventoryRefresh()
      }, 3000)
      return 'XP bottle move requested; waiting for server confirmation.'
    } catch (error) {
      // Even a failed write may have reached the server: block until fresh data.
      move.useAfter = false;
      inventory.delete(source); inventory.delete(destination)
      closeHoldInventory(move)
      requestInventoryRefresh()
      log(`[ALT-PILOT] Could not send XP bottle move: ${safeError(error)}`)
      return 'XP bottle move could not be confirmed. Waiting for fresh inventory.'
    }
  }
  client.on('item_stack_response', packet => {
    const move = pendingHold
    if (!move || !stackRequests) return
    const response = packet.responses?.find(entry => entry.request_id === move.requestId)
    if (!response) return
    if (response.status !== 'ok') {
      inventory.delete(move.source); inventory.delete(move.destination)
      closeHoldInventory(move)
      pendingHold = null
      requestInventoryRefresh()
      log('[ALT-PILOT] Server rejected the XP bottle move; inventory refresh requested.')
      if (move.useAfter && move.sender) reply(move.sender, 'Server rejected the XP bottle move; no use was sent.')
      return
    }
    // A response carries authoritative counts and stack IDs, while the saved
    // request supplies unchanged item metadata. Require both affected slots.
    const slots = (response.containers || []).filter(c => ['hotbar_and_inventory', 'inventory', 'hotbar'].includes(c.slot_type?.container_id))
      .flatMap(c => c.slots || [])
    const source = slots.find(s => s.slot === move.source)
    const destination = slots.find(s => s.slot === move.destination)
    if (!source || !destination || source.count !== (move.previous.count || 0) || destination.count !== move.bottle.count) {
      move.useAfter = false
      closeHoldInventory(move)
      requestInventoryRefresh(); return
    }
    inventory.set(move.source, { ...move.previous, stack_id: source.item_stack_id })
    inventory.set(move.destination, { ...move.bottle, stack_id: destination.item_stack_id })
    completeHold(move)
  })

  function send (line, serverOnly = false) {
    if (!spawned || closing) return
    line = line.trim()
    if (!line || line.length > 100 || /[\x00-\x1f\x7f]/.test(line)) return
    const cleanCmd = serverOnly ? '' : line.replace(/^[\\\/!]/, '').trim().toLowerCase()
    if (cleanCmd === 'use xp' || cleanCmd === 'item use xp') return holdXP(true)
    if (cleanCmd === 'item hold xp') return holdXP()
    if (/^(?:slot|hotbar)\s*(\d+)$/i.test(cleanCmd)) {
      const match = cleanCmd.match(/^(?:slot|hotbar)\s*(\d+)$/i)
      let num = parseInt(match[1], 10)
      if (num >= 1 && num <= 9) num -= 1
      if (num >= 0 && num <= 8) {
        return selectSlot(num) ? `Selected hotbar slot ${num + 1}.` : 'Could not select the hotbar slot.'
      }
      log('[ALT-PILOT] Invalid slot: please specify 1-9.')
      return 'Invalid slot: please specify 1-9.'
    }
    if (/^(?:useitem|use|item\s+use)(?:\s+(\d+))?$/i.test(cleanCmd)) {
      const match = cleanCmd.match(/^(?:useitem|use|item\s+use)(?:\s+(\d+))?$/i)
      let slot = match[1] ? parseInt(match[1], 10) : null
      if (slot !== null && slot >= 1 && slot <= 9) slot -= 1
      return useItem(slot)
    }
    if (/^(?:dropitem|drop|item\s+drop)(?:\s+(\d+))?$/i.test(cleanCmd)) {
      const match = cleanCmd.match(/^(?:dropitem|drop|item\s+drop)(?:\s+(\d+))?$/i)
      let slot = match[1] ? parseInt(match[1], 10) : null
      if (slot !== null && slot >= 1 && slot <= 9) slot -= 1
      return dropItem(slot)
    }
    if (cleanCmd === 'xp' || cleanCmd === 'xp?') {
      const sidebar = [...scoreRows.values()].filter(row => row.objective === sidebarObjective).map(row => chatControls.sidebarXP(row.text)).find(Boolean)
      const replyText = chatControls.xpReply(sidebar, xpLevel, xpProgress)
      log(`[ALT-PILOT] ${replyText}`)
      return replyText
    }
    if (cleanCmd === 'help') {
      for (const section of chatControls.HELP_LINES) log(`[ALT-PILOT] ${section}`)
      return 'Displayed help.'
    }
    if (cleanCmd === 'itemstatus' || cleanCmd === 'item status' || cleanCmd === 'items' || cleanCmd === 'inv' || cleanCmd === 'inventory' || line === '\\itemstatus') {
      const item = inventory.get(heldSlot)
      const hotbarSummary = []
      for (let s = 0; s < 9; s++) {
        const it = inventory.get(s)
        if (it && it.network_id > 0 && it.count > 0) {
          hotbarSummary.push(`slot ${s + 1}: id=${it.network_id} (count ${it.count})`)
        }
      }
      const summaryText = hotbarSummary.length > 0 ? hotbarSummary.join(', ') : 'all empty'
      const statusMsg = `Item status: slot=${heldSlot}, inventory=${inventory.has(heldSlot) ? 'known' : 'unknown'}, item=${item?.network_id ?? 'unknown'}, count=${item?.count ?? 0}, routePending=${routePending}, dropPending=${!!pendingDrop}. Hotbar [${summaryText}].`
      log(`[ALT-PILOT] ${statusMsg}`)
      if (inventory.size === 0) requestInventoryRefresh()
      return statusMsg
    }
    if (line.startsWith('/')) {
      // A rejected/no-op route does not cause an inventory refresh. Keep the
      // server snapshot, but block actions until routing is resolved.
      if (/^\/(?:skyblock|server|hub|lobby)(?:\s|$)/i.test(line)) {
        setRoutePending(true)
        lastActionAt = now()
      }
      const sendPacket = client.options?.transport === 'nethernet' && typeof client.write === 'function' ? client.write.bind(client) : client.queue.bind(client)
      sendPacket('command_request', {
        command: line,
        origin: { type: 'player', uuid: crypto.randomUUID(), request_id: '', player_entity_id: 0n },
        internal: false,
        version: client.versionGreaterThanOrEqualTo('1.21.130') ? 'latest' : 66
      })
    } else {
      const sendPacket = client.options?.transport === 'nethernet' && typeof client.write === 'function' ? client.write.bind(client) : client.queue.bind(client)
      sendPacket('text', { type: 'chat', needs_translation: false, source_name: client.username,
        xuid: profile.xuid, platform_chat_id: '', filtered_message: '', message: line })
    }
  }
  client.on('session', actual => {
    if (String(actual.xuid) !== profile.xuid) finish('Saved Bedrock identity changed. Remove this account and sign in again.')
  })
  function networkActivity () {
    lastPacket = Date.now()
    if (spawned && !closing && lastPacket - lastStatusWrite >= 5000) state(true)
  }
  client.on('packet', networkActivity)
  client.on('alt-pilot-network-activity', networkActivity)
  // Reload live whitelist changes within five seconds.
  let settingsReadAt = 0
  function loadSettings (force = false) {
    if (!force && Date.now() - settingsReadAt < 5000) return settings
    settingsReadAt = Date.now()
    try {
      settings = JSON.parse(fs.readFileSync(path.join(root, 'settings.json')))
    } catch {}
    return settings
  }
  client.on('spawn', () => {
    spawned = true
    state(true)
    log('[ALT-PILOT] Server was successfully joined (Bedrock).')
    if (routeToSkyblock && !initialRouteScheduled) {
      initialRouteScheduled = true
      schedule(() => send('/skyblock'), 20000)
    }
    const curSettings = loadSettings()
    if (curSettings.startup_command_enabled) schedule(() => send(curSettings.startup_command || '/home alt'), Math.max(0, Number(curSettings.startup_delay) || 5) * 1000)
  })
  let xpLevel = null
  let xpProgress = null
  let sidebarObjective = null
  const scoreRows = new Map()
  const commandTimes = new Map()
  const privateReplies = []
  let privateReplyScheduled = false
  let lastPrivateReplyAt = -Infinity
  function deliverPrivateReply () {
    privateReplyScheduled = false
    if (closing || !spawned) { privateReplies.length = 0; return }
    if (!privateReplies.length) return
    send(privateReplies.shift())
    lastPrivateReplyAt = now()
    // Chain from the actual send, so a delayed event loop cannot flush several
    // overdue help sections together in one burst.
    if (privateReplies.length) {
      privateReplyScheduled = true
      schedule(deliverPrivateReply, 1250)
    }
  }
  function reply (sender, message) {
    const prefix = `/msg ${sender} `
    const commands = []
    // Preserve intentional help sections; wrap only within each section.
    for (const section of Array.isArray(message) ? message : [message]) {
      let line = prefix
      for (const word of String(section).split(/\s+/)) {
        if ((line + word).length > 100) { commands.push(line.trim()); line = prefix }
        line += word + ' '
      }
      if (line !== prefix) commands.push(line.trim())
    }
    if (privateReplies.length + commands.length > 16) {
      log('[ALT-PILOT] Private reply backlog is full; reply skipped.')
      return false
    }
    privateReplies.push(...commands)
    if (!privateReplyScheduled) {
      const delay = Math.max(0, lastPrivateReplyAt + 1250 - now())
      if (delay > 0) { privateReplyScheduled = true; schedule(deliverPrivateReply, delay) }
      else deliverPrivateReply()
    }
    return true
  }
  client.on('set_display_objective', packet => {
    if (packet.display_slot === 'sidebar') sidebarObjective = packet.objective_name
  })
  client.on('remove_objective', packet => {
    if (packet.objective_name === sidebarObjective) sidebarObjective = null
    for (const [id, row] of scoreRows) if (row.objective === packet.objective_name) scoreRows.delete(id)
  })
  client.on('set_score', packet => {
    for (const entry of packet.entries || []) {
      const id = String(entry.scoreboard_id)
      if (entry.entry_type === 'remove') scoreRows.delete(id)
      else scoreRows.set(id, { objective: entry.objective_name, text: entry.custom_name || '' })
    }
  })
  client.on('update_attributes', packet => {
    if (String(packet.runtime_entity_id) !== String(client.entityId)) return
    for (const attribute of packet.attributes || []) {
      if (attribute.name === 'minecraft:player.level' && Number.isInteger(attribute.current) && attribute.current >= 0) xpLevel = attribute.current
      if (attribute.name === 'minecraft:player.experience' && Number.isFinite(attribute.current) && attribute.current >= 0 && attribute.current <= 1) xpProgress = attribute.current
    }
  })
  const clearXP = () => { xpLevel = null; xpProgress = null; sidebarObjective = null; scoreRows.clear() }
  client.on('change_dimension', clearXP)
  client.on('respawn', clearXP)
  let lastRoute = 0
  client.on('text', packet => {
    let text = String(packet.message || '')
    if (packet.type === 'translation' && Array.isArray(packet.parameters) && packet.parameters.length >= 2) {
      text = `[${clean(packet.parameters[0])} -> You] ${packet.parameters.slice(1).join(' ')}`
    }
    log(text)
    const plain = text.replace(/§./g, '')
    if (/You(?:'|’)re already on (?:Skyblock|Hub(?: \d+)?|Lobby)|COMPLEX SKYBLOCK|Sending you to Skyblock|island is (?:currently )?(?:offline|restarting|loading)/i.test(plain)) {
      setRoutePending(false)
      if (/COMPLEX SKYBLOCK/i.test(plain)) {
        schedule(() => requestInventoryRefresh(), 2000)
      }
    }
    const curSettings = loadSettings()
    const incoming = chatControls.parseCommand(packet, profile.name || client.username || '')
    if (/\b(?:xp\??|help|hlep)\s*$/i.test(plain)) {
      log('[ALT-PILOT] Chat command check: ' + JSON.stringify({ type: packet.type, source: packet.source_name || '', parameters: packet.parameters, parsed: incoming, allowed: Boolean(incoming && chatControls.whitelisted(incoming.sender, curSettings.tpa_whitelist)) }))
    }
    if (incoming && chatControls.whitelisted(incoming.sender, curSettings.tpa_whitelist)) {
      const { sender, command } = incoming
      const key = sender.toLowerCase().replace(/^\./, '')
      const previous = commandTimes.get(key) ?? -Infinity
      // Limit each sender independently so one player cannot lock out others.
      if (now() - previous >= 1000) {
        commandTimes.set(key, now())
        for (const [name, stamp] of commandTimes) if (now() - stamp > 60000) commandTimes.delete(name)
        if (command.startsWith('/')) {
          if (spawned && !closing) {
            send(command, true)
            reply(sender, 'Command sent to the server.')
          }
        } else if (command === 'help') {
          const helpKey = key + '/help'
          if (now() - (commandTimes.get(helpKey) ?? -Infinity) >= 5000 && reply(sender, chatControls.HELP_LINES)) {
            commandTimes.set(helpKey, now())
          }
        } else if (command.startsWith('whitelist ') || command === 'restart') {
          const parts = command.split(' ')
          const operation = command === 'restart' ? 'restart' : parts[1]
          const target = command === 'restart' ? '' : parts[2]
          try {
            const folder = path.join(root, 'chat-requests')
            fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
            // Bound the disk queue if the control service is unavailable.
            if (fs.readdirSync(folder).filter(name => name.endsWith('.json')).length >= 20) {
              reply(sender, 'Command queue is full. Please try again later.')
            } else {
              const file = path.join(folder, crypto.randomUUID().replace(/-/g, '') + '.json')
              atomicJson(file, { sender, operation, target, created: Date.now() / 1000 })
              log(`[ALT-PILOT] Queued ${operation} request from ${sender}.`)
              reply(sender, 'Request queued; waiting for the control service.')
            }
          } catch (error) {
            log(`[ALT-PILOT] Could not queue chat command: ${safeError(error)}`)
            reply(sender, 'Could not queue the command. Please try again later.')
          }
        } else if (command === 'xp?' || command === 'xp') {
          const sidebar = [...scoreRows.values()].filter(row => row.objective === sidebarObjective).map(row => chatControls.sidebarXP(row.text)).find(Boolean)
          reply(sender, chatControls.xpReply(sidebar, xpLevel, xpProgress))
        } else {
          log(`[ALT-PILOT] Whitelisted chat action from ${sender}: ${command}.`)
          reply(sender, command === 'use xp' || command === 'item use xp' ? holdXP(true, sender) : command === 'item hold xp' ? holdXP() : command === 'item use' ? useItem() : dropItem())
        }
      }
    }
    if (/^Hub \d+\s/i.test(plain) && Date.now() - lastRoute > 30000) {
      lastRoute = Date.now(); schedule(() => send('/skyblock'), 20000)
    }
    if (curSettings.startup_command_enabled && /Sending you to Skyblock|COMPLEX SKYBLOCK|island is (?:currently )?(?:offline|restarting|loading)/i.test(plain) && Date.now() - lastRoute > 5000) {
      lastRoute = Date.now(); schedule(() => send(curSettings.startup_command || '/home alt'), 10000)
    }
    if (curSettings.tpa_auto_accept && /has requested (?:for you|that you) to teleport to them/i.test(plain)) {
      const match = plain.match(/(?:\]|\s)(\S+)\*?\s+has requested (?:for you|that you) to teleport to them/i)
      const rawNames = String(curSettings.tpa_whitelist || '').toLowerCase().split(/[\s,]+/)
      const names = rawNames.flatMap(n => [n, n.replace(/^\./, ''), `.${n.replace(/^\./, '')}`])
      if (match) {
        const sender = match[1].replace(/\*$/, '').toLowerCase()
        if (names.includes(sender) || names.includes(sender.replace(/^\./, ''))) {
          log(`[ALT-PILOT] Auto-accepting teleport request from ${match[1]}`)
          send('/tpyes')
        }
      }
    }
  })
  client.on('command_output', packet => {
    for (const entry of packet.output || []) log(`${entry.message_id || ''} ${(entry.parameters || []).join(' ')}`.trim())
  })
  client.on('kick', packet => finish(`Server disconnected this account: ${packet.message || 'no reason supplied'}`))
  client.on('close', () => finish('Bedrock connection closed; reconnecting.'))
  client.on('error', error => {
    if (isPacketReadError(error)) {
      if (process.env.DEBUG) log(`[ALT-PILOT] Skipped unparseable packet: ${safeError(error)}`)
      return
    }
    finish(error)
  })
  client.on('start_game', packet => {
    if (packet) {
      if (packet.runtime_entity_id != null) {
        Object.defineProperty(client, 'entityId', {
          value: packet.runtime_entity_id,
          writable: true,
          configurable: true
        })
      }
      if (packet.player_position) currentPos = packet.player_position
    }
  })
  client.on('move_player', packet => {
    if (packet && packet.position && packet.runtime_id != null && String(packet.runtime_id) === String(client.entityId)) currentPos = packet.position
  })
  client.on('inventory_content', packet => {
    if (!packet || !mainInventory(packet.window_id) || !Array.isArray(packet.input)) return
    inventory.clear()
    setRoutePending(false)
    packet.input.forEach((item, slot) => updateSlot(slot, item))
    confirmHoldSnapshot()
    // A complete server snapshot resolves rejected/no-op moves too.
    if (pendingHold && inventoryRefresh) {
      closeHoldInventory(pendingHold)
      pendingHold = null
      log('[ALT-PILOT] Inventory refreshed; XP bottle move was not confirmed. You can retry.')
    }
    if (inventoryRefresh) {
      inventoryRefresh.snapshot = true
      closeInventoryRefresh()
    }
  })
  client.on('inventory_slot', packet => {
    if (packet && mainInventory(packet.window_id)) {
      updateSlot(packet.slot, packet.item)
      confirmHoldSnapshot()
    }
  })
  client.on('mob_equipment', packet => {
    if (!packet) return
    if (client.entityId != null && packet.runtime_entity_id != null && String(packet.runtime_entity_id) !== String(client.entityId)) return
    if (packet.window_id != null && !mainInventory(packet.window_id)) return
    if (Number.isInteger(packet.selected_slot) && packet.selected_slot >= 0 && packet.selected_slot < 9) {
      heldSlot = packet.selected_slot
    }
    // Equipment is not an authoritative inventory refresh or drop acknowledgement.
  })
  client.on('player_hotbar', packet => {
    if (!packet || (packet.window_id != null && !mainInventory(packet.window_id))) return
    if (Number.isInteger(packet.selected_slot) && packet.selected_slot >= 0 && packet.selected_slot < 9) heldSlot = packet.selected_slot
  })
  client.on('container_open', packet => {
    containerOpen = true
    if (holdInventory && mainInventory(packet?.window_id) && packet.window_type === 'inventory') {
      holdInventory.opened = true
      holdInventory.windowType = packet.window_type
      closeHoldInventory()
    }
    if (inventoryRefresh && mainInventory(packet?.window_id) && packet.window_type === 'inventory') {
      inventoryRefresh.opened = true
      inventoryRefresh.windowType = packet.window_type
      closeInventoryRefresh()
    }
  })
  client.on('container_close', () => {
    containerOpen = false
    if (pendingUseSlot !== null) schedule(() => { if (pendingUseSlot !== null) requestInventoryRefresh() }, 300)
  })
  client.on('change_dimension', resetInventory)
  client.on('respawn', resetInventory)
  // A transfer must be handled explicitly; reconnecting to the configured entry
  // point preserves the authenticated destination boundary.
  client.on('transfer', () => finish('Server requested a transfer; reconnecting through the configured entry point.'))
  return { send, finish, useItem, dropItem, selectSlot }
}
async function run (root) {
  process.on('uncaughtException', err => {
    if (isPacketReadError(err)) {
      if (process.env.DEBUG) console.log(`[ALT-PILOT] Suppressed packet parsing exception: ${safeError(err)}`)
      return
    }
    console.error(`[ALT-PILOT] Uncaught exception: ${safeError(err)}`)
    process.exit(1)
  })
  process.on('unhandledRejection', err => {
    if (isPacketReadError(err)) {
      if (process.env.DEBUG) console.log(`[ALT-PILOT] Suppressed unhandled packet rejection: ${safeError(err)}`)
      return
    }
    console.error(`[ALT-PILOT] Unhandled rejection: ${safeError(err)}`)
    process.exit(1)
  })
  const bedrock = require('bedrock-protocol')
  const profile = JSON.parse(fs.readFileSync(path.join(root, 'bedrock/profile.json')))
  let settings = {}
  try { settings = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'))) } catch {}
  const address = endpoint(process.env.MC_SERVER)
  const host = await resolveHost(address.host)
  const client = bedrock.createClient({ ...address, host, ...sessionAuthOptions(profile), username: 'alt-pilot',
    profilesFolder: path.join(root, 'bedrock'), offline: false, followPort: false,
    connectTimeout: 20000, viewDistance: 2, ...transportOptions(address),
    onMsaCode: () => { console.error('Bedrock authorization expired. Sign out and add this account again.'); process.exit(1) },
    conLog: message => console.log(`[ALT-PILOT] ${message}`)
  })
  configurePassiveDecoding(client)
  client.viewDistance = 2
  const routeToSkyblock = process.env.MC_SERVER?.split(':')[0] === 'skyblock.mc-complex.com'
  const session = attachSession(client, { root, profile, settings, routeToSkyblock })
  readline.createInterface({ input: process.stdin }).on('line', session.send)
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => session.finish('Stopped.', 0))
}
if (require.main === module) {
  process.umask(0o077)
  const [mode, root] = process.argv.slice(2)
  if (!['login', 'run'].includes(mode) || !root) process.exit(2)
  const log = console.log
  function formatLogMessage (...args) {
    const text = args.map(x => typeof x === 'string' ? safeError(x) : '[client message]').join(' ')
    const d = new Date()
    const stamp = `[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}]`
    return text.split('\n').map(line => /^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\]/.test(line) ? line : `${stamp} ${line}`).join('\n')
  }
  if (mode === 'run') {
    console.log = (...args) => log(formatLogMessage(...args))
    console.error = (...args) => log(formatLogMessage(...args))
  } else {
    console.log = (...args) => log(...args.map(x => typeof x === 'string' ? safeError(x) : '[client message]'))
    console.error = (...args) => log(...args.map(safeError))
  }
  ;(mode === 'login' ? login(root) : run(root)).catch(error => { console.error(safeError(error)); process.exit(1) })
}
module.exports = { profileFromChain, endpoint, resolveHost, attachSession, safeError, bedrockLicenseError, bedrockLicenseMessage, sessionAuthOptions, PLATFORM, isPacketReadError }
