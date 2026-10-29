'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createScheduler } = require('./native-events')

test('native callback flood uses one pending task and yields between bounded ordered batches', () => {
  const tasks = [], delivered = []
  const enqueue = createScheduler({ schedule: fn => tasks.push(fn), batchSize: 4 })
  for (let i = 0; i < 10; i++) enqueue(() => delivered.push(i))
  assert.equal(tasks.length, 1)
  tasks.shift()()
  assert.deepEqual(delivered, [0, 1, 2, 3])
  assert.equal(tasks.length, 1)
  // A health/command timer gets control between batches.
  delivered.push('health')
  while (tasks.length) tasks.shift()()
  assert.deepEqual(delivered, [0, 1, 2, 3, 'health', 4, 5, 6, 7, 8, 9])
  enqueue(() => delivered.push(10))
  assert.equal(tasks.length, 1)
  tasks.shift()()
  assert.equal(delivered.at(-1), 10)
})
test('a throwing packet callback does not strand later native events', () => {
  const tasks = [], delivered = []
  const enqueue = createScheduler({ schedule: fn => tasks.push(fn) })
  enqueue(() => { throw new Error('bad packet') }); enqueue(() => delivered.push('later'))
  assert.throws(() => tasks.shift()(), /bad packet/)
  tasks.shift()()
  assert.deepEqual(delivered, ['later'])
})

test('default scheduler yields after 32 events so timers are not blocked by thousands of packets', () => {
  const tasks = []; let delivered = 0
  const enqueue = createScheduler({ schedule: fn => tasks.push(fn) })
  for (let i = 0; i < 100; i++) enqueue(() => delivered++)
  tasks.shift()()
  assert.equal(delivered, 32)
  while (tasks.length) tasks.shift()()
  assert.equal(delivered, 100)
})

test('expensive callbacks yield by elapsed time before the event count limit', () => {
  const tasks = [], delivered = []
  let elapsed = 0
  const enqueue = createScheduler({ schedule: fn => tasks.push(fn), clock: () => elapsed, budgetMs: 4 })
  for (let i = 0; i < 8; i++) enqueue(() => { delivered.push(i); elapsed += 3 })
  tasks.shift()()
  assert.deepEqual(delivered, [0, 1])
  delivered.push('console timer')
  while (tasks.length) tasks.shift()()
  assert.deepEqual(delivered, [0, 1, 'console timer', 2, 3, 4, 5, 6, 7])
})
