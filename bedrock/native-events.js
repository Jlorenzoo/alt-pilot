'use strict'

// Native WebRTC can deliver an unbroken burst of callbacks. Drain bounded
// batches in the event loop check phase so health, command and reply timers also run.
function createScheduler ({ schedule = fn => setImmediate(fn), batchSize = 32, budgetMs = 4, clock = () => performance.now() } = {}) {
  let queue = [], cursor = 0, pending = false
  function drain () {
    try {
      const deadline = clock() + budgetMs
      const end = Math.min(queue.length, cursor + batchSize)
      while (cursor < end) {
        const callback = queue[cursor]
        queue[cursor++] = null
        callback()
        if (clock() >= deadline) break
      }
    } finally {
      if (cursor === queue.length) { queue = []; cursor = 0; pending = false }
      else {
        if (cursor >= 256) { queue = queue.slice(cursor); cursor = 0 }
        schedule(drain)
      }
    }
  }
  return function enqueue (callback) {
    queue.push(callback)
    if (!pending) { pending = true; schedule(drain) }
  }
}

module.exports = { createScheduler, enqueueNativeEvent: createScheduler() }
