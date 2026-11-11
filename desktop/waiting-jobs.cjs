const { randomUUID } = require('node:crypto');

// A restart never replays a model request. Recover an unstarted job as a paused,
// ordinary follow-up, preserving the draft the user may have typed after it.
function recoverWaitingJob(task) {
  const waiting = task.pendingJob;
  if (!waiting) return false;
  delete task.pendingJob;
  if (task.runHistory.at(-1)?.id !== waiting.priorRunId) return false;
  task.queue ??= [];
  if (waiting.queuedId && task.queue.some(({ id }) => id === waiting.queuedId)) {
    task.queuePaused = true;
    return true;
  }
  task.queue.unshift({ id: randomUUID(), queuedAt: waiting.queuedAt, ...waiting.draft,
    setup: waiting.setup, teamworkSnapshot: waiting.teamworkSnapshot });
  task.queuePaused = true;
  return true;
}

module.exports = { recoverWaitingJob };
