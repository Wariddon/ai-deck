const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverWaitingJob } = require('../desktop/waiting-jobs.cjs');
test('restart recovers an unstarted request once, paused, preserving the newer composer draft', () => {
  const task = { runHistory: [], queue: [], savedDraft: { prompt: 'newer unsent draft' },
    pendingJob: { draft: { mode: 'codex', prompt: 'waiting request', images: [{ id: 'picture' }] }, setup: { scope: 'original' } } };
  assert.equal(recoverWaitingJob(task), true);
  assert.equal(task.queue[0].prompt, 'waiting request');
  assert.deepEqual(task.queue[0].images, [{ id: 'picture' }]);
  assert.equal(task.savedDraft.prompt, 'newer unsent draft');
  assert.equal(task.queuePaused, true);
  assert.equal(recoverWaitingJob(task), false); assert.equal(task.queue.length, 1);
});
test('a started run and an already queued request cannot be duplicated during recovery', () => {
  const started = { runHistory: [{ id: 'started' }], queue: [], pendingJob: { priorRunId: 'before', draft: { prompt: 'already sent' } } };
  assert.equal(recoverWaitingJob(started), false); assert.equal(started.queue.length, 0);
  const queued = { runHistory: [], queue: [{ id: 'q', prompt: 'one' }], pendingJob: { queuedId: 'q', draft: { prompt: 'one' } } };
  assert.equal(recoverWaitingJob(queued), true); assert.equal(queued.queue.length, 1);
});
