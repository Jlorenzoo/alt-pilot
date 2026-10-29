'use strict'
const HELP_LINES = Object.freeze([
  '[Help 1/4] Items: use xp | item use | item drop',
  '[Help 2/4] xp? | help | PM !command args',
  '[Help 3/4] Access: whitelist add/remove NAME',
  '[Help 4/4] Client: restart (this alt only)'
])
const clean = value => String(value || '').replace(/§(?:#[0-9a-fA-F]{6}|.)/g, '')
const canonical = value => value.toLowerCase().replace(/^\./, '')
const validName = value => /^\.?[A-Za-z0-9_]{1,32}$/.test(value)
function parseCommand (packet, self = '') {
  if (/[\x00-\x1f\x7f-\x9f]/.test(String(packet.message || '')) || (Array.isArray(packet.parameters) ? packet.parameters : []).some(value => /[\x00-\x1f\x7f-\x9f]/.test(String(value)))) return null
  let text = clean(packet.message || '')
  let sourceName = clean(packet.source_name || '')
  if (packet.type === 'translation' && Array.isArray(packet.parameters) && packet.parameters.length >= 2) {
    sourceName = clean(packet.parameters[0])
    text = clean(packet.parameters.slice(1).join(' '))
  } else if (!text && Array.isArray(packet.parameters) && packet.parameters.length) {
    text = clean(packet.parameters.join(' '))
  }
  if (text.length > 2048 || /[\r\n\x00]/.test(text)) return null
  const body = text.trim()
  let sender, command
  const bang = '!/?[A-Za-z0-9_][A-Za-z0-9_:.-]{0,63}(?: +[^\\x00-\\x1f\\x7f-\\x9f]+)?'
  const isBang = value => new RegExp('^' + bang + '$').test(value) && value.length <= 100
  const privatePacket = packet.type === 'whisper' || (packet.type === 'translation' && packet.message === 'commands.message.display.incoming')
  if (privatePacket && validName(sourceName) && isBang(body)) {
    sender = sourceName; command = body
  } else if (['chat', 'whisper', 'translation'].includes(packet.type) && validName(sourceName) && /^(?:use xp|item use xp|item use|item drop|item hold xp|xp\?|xp|help|hlep|restart|whitelist (?:add|remove) \.?[A-Za-z0-9_]{1,32})$/i.test(body)) {
    sender = sourceName; command = body
  } else {
    // Anchor the complete server-rendered line. Never search inside another
    const name = '(\\.?[A-Za-z0-9_]{1,32})\\*?'
    const cmd = '(use xp|item use xp|item use|item drop|item hold xp|xp\\?|xp|help|hlep|restart|whitelist (?:add|remove) \\.?[A-Za-z0-9_]{1,32})'
    const privateCmd = cmd.slice(0, -1) + '|' + bang + ')'
    const ranks = '(?:\\[[^\\]\\r\\n]{1,100}\\]\\s*)*'
    const arrow = '(?:->|→|»|➜|➤|⇒)'
    const patterns = [
      new RegExp('^[▌\\s]*(?:Hub \\d+\\s+)?' + ranks + name + '\\s*:\\s*' + cmd + '\\s*$', 'i'),
      new RegExp('^<' + name + '>\\s*' + cmd + '\\s*$', 'i'),
      new RegExp('^[▌\\s]*' + ranks + name + '\\s+whispers?(?:\\s+to\\s+you)?\\s*:\\s*' + privateCmd + '\\s*$', 'i'),
      new RegExp('^[▌\\s]*' + ranks + '\\[\\s*' + name + '\\s*' + arrow + '\\s*' + ranks + '(me|\\.?[A-Za-z0-9_]{1,32})\\s*\\]\\s*:?\\s*' + privateCmd + '\\s*$', 'i'),
      new RegExp('^[▌\\s]*(?:From|Message from)\\s+' + ranks + name + '\\s*:\\s*' + privateCmd + '\\s*$', 'i'),
      new RegExp('^[▌\\s]*(?:(?:Skyblock|Hub(?: \\d+)?|Lobby)\\s+)?' + ranks + name + '\\s+' + arrow + '\\s+' + ranks + '(You|me|\\.?[A-Za-z0-9_]{1,32})\\s*:?\\s*' + privateCmd + '\\s*$', 'i')
    ]
    for (let i = 0; i < patterns.length; i++) {
      const match = body.match(patterns[i])
      if (!match) continue
      const recipient = i === 3 || i === 5
      if (recipient && !['me', 'you'].includes(match[2].toLowerCase()) && canonical(match[2]) !== canonical(self)) continue
      sender = match[1]; command = match[recipient ? 3 : 2]; break
    }
  }
  // Some gateways include BOTH the source and the server-rendered chat line.
  // Their attributed source must agree with the parsed sender; never allow
  // Evil's message "Admin: item drop" to impersonate Admin.
  if (['chat', 'whisper', 'translation'].includes(packet.type) && sourceName && canonical(sourceName) !== canonical(sender || '')) return null
  if (command && command.startsWith('!') && !isBang(command)) return null
  if (!sender || canonical(sender) === canonical(self)) return null
  return { sender, command: command.startsWith('!') ? '/' + command.slice(1).replace(/^\//, '') : command.toLowerCase() === 'hlep' ? 'help' : command.toLowerCase() }
}
function whitelisted (sender, whitelist) {
  return String(whitelist || '').split(/[\s,]+/).filter(validName).some(name => canonical(name) === canonical(sender))
}
function sidebarXP (text) {
  const match = clean(text).match(/^\s*[^A-Za-z0-9]*(?:Experience|EXP|XP)\s*:\s*([0-9][0-9.,]*(?:\s*[KMBT])?)\s*$/i)
  return match ? match[1].replace(/\s/g, '').toUpperCase() : null
}
function estimatedXP (level, progress) {
  if (!Number.isInteger(level) || level < 0 || !Number.isFinite(progress) || progress < 0 || progress > 1) return null
  const base = level <= 16 ? level * level + 6 * level : level <= 31 ? 2.5 * level * level - 40.5 * level + 360 : 4.5 * level * level - 162.5 * level + 2220
  const next = level < 15 ? 2 * level + 7 : level < 30 ? 5 * level - 38 : 9 * level - 158
  return Math.round(base + progress * next)
}
function xpReply (sidebar, level, progress) {
  if (sidebar) return sidebar + ' XP'
  const xp = estimatedXP(level, progress)
  if (xp === null) return 'XP unavailable until the server updates it.'
  const compact = xp >= 1e6 ? (xp / 1e6).toFixed(2) + 'M' : xp >= 1000 ? (xp / 1000).toFixed(2) + 'K' : String(xp)
  return `~${compact} XP (level ${level})`
}
module.exports = { HELP_LINES, parseCommand, whitelisted, sidebarXP, estimatedXP, xpReply }
