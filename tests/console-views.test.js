const {test} = require('node:test');
const assert = require('node:assert/strict');
const feed = require('../web/console-format.js');
const entries = [
  {category: 'client', tone: 'client', message: 'Heartbeat OK', time: '10:00:01'},
  {category: 'server', tone: 'server', message: 'Visit the store', time: '10:00:02'},
  {category: 'player', tone: 'player', message: '§a<PlayerOne> Ready?', time: '10:00:03'},
  {category: 'whisper', tone: 'whisper', message: 'PlayerTwo -> You: Ready now', time: '10:00:04'},
  {category: 'self', tone: 'sent', message: '/tpaccept', time: '10:00:05'},
  {category: 'client', tone: 'error', message: 'Connection lost', time: '10:00:06'},
  {category: 'server', tone: 'warning', message: 'Restart in 5 minutes', time: '10:00:07'},
];
test('conversation removes routine notices but retains chat, sent messages, and issues', () => {
  assert.deepEqual(feed.selectEntries(entries), entries.slice(2));
  assert.equal(feed.selectEntries(entries, 'all').length, 7);
});
test('issues isolates warnings and failures across sources', () => {
  assert.deepEqual(feed.selectEntries(entries, 'attention'), entries.slice(5));
});
test('search combines with the selected view and ignores Minecraft formatting', () => {
  assert.deepEqual(feed.selectEntries(entries, 'conversation', 'READy'), entries.slice(2, 4));
  assert.deepEqual(feed.selectEntries(entries, 'player', 'playerone'), [entries[2]]);
  assert.equal(feed.selectEntries(entries, 'client', 'ready').length, 0);
});
test('source views retain all messages of that source', () => {
  assert.deepEqual(feed.selectEntries(entries, 'client'), [entries[0], entries[5]]);
});
test('repeated log entries compact without changing the input or losing their count', () => {
  const source = [entries[0], {...entries[0], time: '10:00:09'}, entries[1]];
  const result = feed.compactEntries(source);
  assert.equal(result.length, 2);
  assert.equal(result[0].repeats, 2);
  assert.equal(result[0].time, '10:00:09');
  assert.equal(source[0].repeats, undefined);
  assert.equal(source[0].time, '10:00:01');
});
test('player chat and whispers are never compacted, and severity changes remain separate', () => {
  for (const entry of entries.slice(2, 5)) assert.equal(feed.compactEntries([entry, entry]).length, 2);
  assert.equal(feed.compactEntries([entries[0], {...entries[0], tone:'error'}]).length, 2);
});

test('filtering does not merge issues that were separated by other messages', () => {
  const source = [entries[5], entries[2], {...entries[5], time:'10:01:00'}];
  const rows = feed.selectEntries(feed.compactEntries(source), 'attention');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.repeats === 1));
});
