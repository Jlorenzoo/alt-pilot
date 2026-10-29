'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseCommand, whitelisted, sidebarXP, estimatedXP, xpReply } = require('./chat-controls')

test('commands have exact bodies and attributed senders in public chat and whispers', () => {
  for (const message of ['§7[Rank] §aAdmin§7: item use', '<Admin> item drop', 'Admin whispers to you: xp?', 'Admin whispers to you: xp', '[Admin -> me] help', '[Admin -> .TestAlt] whitelist add NewPlayer', 'From Admin: whitelist remove NewPlayer', '§7Skyblock §8[§bMember§8]§f Admin §f➜ §dYou§7: §dhelp', '▌ Skyblock [Member] Admin ➜ TestAlt: restart', '▌ Skyblock [Member] Admin ➜ [Member] .TestAlt: xp']) {
    const parsed = parseCommand({ type: 'raw', message }, 'TestAlt')
    assert.equal(parsed?.sender, 'Admin', message)
  }
  assert.equal(parseCommand({ type: 'chat', source_name: '.Admin', message: 'ITEM DROP' }, 'TestAlt').command, 'item drop')
  assert.equal(parseCommand({ type: 'chat', source_name: 'Admin', message: 'Skyblock [Member] Admin ➜ You: help' }, 'TestAlt').command, 'help')
  assert.equal(parseCommand({ type: 'chat', source_name: 'Admin', message: 'xp' }, 'TestAlt').command, 'xp')
  assert.equal(parseCommand({ type: 'chat', source_name: 'Admin', message: 'xp?' }, 'TestAlt').command, 'xp?')
  assert.equal(parseCommand({ type: 'translation', message: 'commands.message.display.incoming', parameters: ['Admin', 'xp'] }, 'TestAlt').command, 'xp')
  assert.equal(parseCommand({ type: 'translation', message: 'commands.message.display.incoming', parameters: ['_Jlorenzoo_', 'help'] }, 'TestAlt').sender, '_Jlorenzoo_')
  assert.equal(parseCommand({ type: 'chat', source_name: 'Evil', message: 'Skyblock [Member] Admin ➜ You: help' }, 'TestAlt'), null)
  assert.equal(whitelisted('.ADMIN', 'Admin, Other'), true)
  assert.equal(whitelisted('AdminExtra', 'Admin'), false)
})
test('forged names, command substrings, announcements and outgoing whispers are ignored', () => {
  for (const message of ['Evil: [Rank] Admin: item drop', 'Evil: Admin whispers to you: item drop', 'Announcement Admin: item drop', '[Admin -> OtherAlt] item drop', 'Admin: please item drop', 'Admin: please xp', 'Admin: xpx', 'Admin: item drop\nanything', 'Admin: whitelist add Bad;Name', 'TestAlt: item drop', 'Skyblock [Member] Admin ➜ OtherAlt: item drop', 'Skyblock You ➜ [Member] Admin: help', 'Evil: Skyblock [Member] Admin ➜ You: restart']) {
    assert.equal(parseCommand({ type: 'raw', message }, 'TestAlt'), null, message)
  }
  assert.equal(parseCommand({ type: 'raw', source_name: 'Admin', message: 'item drop' }, 'TestAlt'), null)
})
test('XP uses the displayed Experience balance and a clearly labelled level estimate', () => {
  assert.equal(sidebarXP('§c▪ Experience: §f872.23K'), '872.23K')
  assert.equal(sidebarXP('Balance: 872K'), null)
  assert.equal(xpReply('872.23K', 1, 0), '872.23K XP')
  assert.equal(estimatedXP(458, 0), 871733)
  assert.equal(xpReply(null, 458, 0), '~871.73K XP (level 458)')
  assert.equal(xpReply(null, null, null), 'XP unavailable until the server updates it.')
})

test('common help typo follows the same private parsing and spoof checks', () => {
  assert.deepEqual(parseCommand({ type: 'whisper', source_name: 'Admin', message: 'hlep' }, 'TestAlt'), { sender: 'Admin', command: 'help' })
  assert.deepEqual(parseCommand({ type: 'raw', message: 'Skyblock [Member] Admin ➜ You: hlep' }, 'TestAlt'), { sender: 'Admin', command: 'help' })
  assert.equal(parseCommand({ type: 'chat', source_name: 'Evil', message: 'Skyblock [Member] Admin ➜ You: hlep' }, 'TestAlt'), null)
})

test('bang commands preserve arguments and require an incoming private message', () => {
  for (const message of ['Admin whispers to you: !pay JLorenzoo 1', '[Admin -> TestAlt] !pay JLorenzoo 1', 'From Admin: !pay JLorenzoo 1', 'Skyblock [Member] Admin ➜ You: !pay JLorenzoo 1']) {
    assert.deepEqual(parseCommand({ type: 'raw', message }, 'TestAlt'), { sender: 'Admin', command: '/pay JLorenzoo 1' })
  }
  assert.equal(parseCommand({ type: 'whisper', source_name: 'Admin', message: '!/minecraft:msg Player MixedCASE' }, 'TestAlt').command, '/minecraft:msg Player MixedCASE')
  assert.equal(parseCommand({ type: 'translation', message: 'commands.message.display.incoming', parameters: ['Admin', '!pay JLorenzoo 1'] }, 'TestAlt').command, '/pay JLorenzoo 1')
  for (const packet of [
    { type: 'chat', source_name: 'Admin', message: '!pay JLorenzoo 1' },
    { type: 'translation', message: 'chat.type.text', parameters: ['Admin', '!pay JLorenzoo 1'] },
    { type: 'translation', message: 'commands.message.display.outgoing', parameters: ['Admin', '!pay JLorenzoo 1'] },
    { type: 'raw', message: '<Admin> !pay JLorenzoo 1' },
    { type: 'raw', message: 'Admin: !pay JLorenzoo 1' },
    { type: 'raw', message: '[Admin -> OtherAlt] !pay JLorenzoo 1' },
    { type: 'raw', message: 'Evil: Admin whispers to you: !pay JLorenzoo 1' },
    { type: 'whisper', source_name: 'Evil', message: 'Admin whispers to you: !pay JLorenzoo 1' },
    { type: 'translation', message: 'commands.message.display.incoming', parameters: ['Evil', 'Admin whispers to you: !pay JLorenzoo 1'] },
    ...['!', '!/','!!pay Player 1', '! pay Player 1', '!pay Player 1\n', '!pay Player\t1', '!pay Player\x001', '!pay ' + 'a'.repeat(96)].map(message => ({ type: 'whisper', source_name: 'Admin', message }))
  ]) assert.equal(parseCommand(packet, 'TestAlt'), null, JSON.stringify(packet))
})

test('truecolor private messages strip complete hex codes including inside player names', () => {
  const message = '§#aaaaaaSkyblock [§#ff5555Pharaoh➕§#aaaaaa] ' +
    [...'JLorenzoo'].map(letter => '§#FF5555§l' + letter).join('') +
    ' §#ffffff➜ §#ff55ffYou§#aaaaaa: §#ff55ff!pay jlorenzoo 1'
  assert.deepEqual(parseCommand({ type: 'raw', message }, '_Jlorenzoo_'), { sender: 'JLorenzoo', command: '/pay jlorenzoo 1' })
  assert.equal(parseCommand({ type: 'whisper', source_name: 'Evil', message }, '_Jlorenzoo_'), null)
  assert.deepEqual(parseCommand({ type: 'whisper', source_name: '§#ff5555JLorenzoo', message: '!pay jlorenzoo 1' }, '_Jlorenzoo_'), { sender: 'JLorenzoo', command: '/pay jlorenzoo 1' })
})
