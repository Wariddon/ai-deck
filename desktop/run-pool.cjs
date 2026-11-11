const { AsyncLocalStorage } = require('node:async_hooks');

// The async scope belongs to a submitted job, never to the selected sidebar row.
class RunPool {
  constructor({ limit = () => 2, headroom = () => Infinity, blocked = () => false, changed = () => {}, failed = () => {} } = {}) {
    Object.assign(this, { limit, headroom, blocked, changed, failed });
    this.context = new AsyncLocalStorage();
    this.entries = new Map();
  }
  get scope() { return this.context.getStore(); }
  get size() { return this.entries.size; }
  outside(fn) { return this.context.exit(fn); }
  get(key) { return this.entries.get(key)?.job; }
  has(job) { return [...this.entries.values()].some((entry) => entry.job === job); }
  all() { return [...this.entries.values()].map((entry) => entry.job); }
  adopt(job) {
    const scope = this.scope;
    if (!scope || this.entries.get(scope.key) !== scope || scope.cancelled) throw new Error('This job is no longer scheduled.');
    scope.job = job;
    job.workspace = scope.workspace;
    job.poolKey = scope.key;
    this.changed();
    return job;
  }
  reason(entry) {
    const running = [...this.entries.values()].filter((other) => other !== entry && other.state !== 'waiting');
    if (this.blocked() || running.some((other) => other.state === 'preparing')) return 'Preparing another job';
    if (running.length >= this.limit()) return this.limit() === 1 ? 'Low RAM: one job at a time' : 'Waiting for a free job slot';
    if (running.length && this.headroom() < 384 * 1024 ** 2) return 'Waiting for available RAM';
    if (running.some((other) => entry.locks.some((lock) => other.locks.some((held) => locksOverlap(lock, held))))) {
      return 'Waiting for the same chat or working folder';
    }
    return '';
  }
  submit({ key, workspace, task, locks = [], title, job }, start) {
    if (this.entries.has(key)) throw new Error('This session already has a job. Queue a follow-up or wait for it to finish.');
    const entry = { key, workspace, task, locks, title, start, state: 'waiting',
      job: job ?? { task, workspace, waiting: true, approvals: [], stopping: false } };
    this.entries.set(key, entry);
    entry.job.poolKey = key;
    const reason = this.reason(entry);
    entry.reason = reason;
    this.changed();
    if (!reason) return this.launch(entry);
    entry.detached = true;
    this.wake();
    return Promise.resolve({ started: true, waiting: true });
  }
  launch(entry) {
    entry.state = 'preparing';
    entry.reason = '';
    entry.job.waiting = false;
    this.changed();
    return this.context.run(entry, async () => {
      try {
        const result = await entry.start();
        if (this.entries.get(entry.key) === entry) entry.state = 'running';
        this.changed();
        this.wake();
        return result;
      } catch (error) {
        this.release(entry);
        if (entry.detached) { this.failed(entry, error); return; }
        throw error;
      }
    });
  }
  release(entry = this.scope) {
    if (!entry || this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    this.changed();
    this.wake();
  }
  cancel(key) {
    const entry = this.entries.get(key);
    if (!entry || entry.state !== 'waiting' && !(entry.state === 'preparing' && !entry.job.run?.id)) return false;
    entry.cancelled = true;
    entry.job.stopping = true;
    entry.job.rejectWaiting?.(new Error('The waiting job was stopped. Your draft is unchanged.'));
    this.release(entry);
    return true;
  }
  wake() {
    if (this.timer || ![...this.entries.values()].some((entry) => entry.state === 'waiting')) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      for (const entry of this.entries.values()) {
        if (entry.state !== 'waiting') continue;
        entry.reason = this.reason(entry);
        if (!entry.reason) { void this.launch(entry); break; }
      }
      this.wake();
    }, 250);
    this.timer.unref?.();
  }
  close() {
    clearTimeout(this.timer);
    this.timer = null;
    for (const entry of [...this.entries.values()]) if (entry.state === 'waiting') this.cancel(entry.key);
    clearTimeout(this.timer);
    this.timer = null;
  }
  snapshot() {
    return [...this.entries.values()].map(({ key, task, workspace, state, reason, title, job }) => ({
      key, taskId: task?.id, repo: workspace?.repo, title: title ?? task?.title ?? 'Original chat',
      state, reason, runId: job.run?.id, summaryOnly: job.summaryOnly, scheduled: Boolean(job.scheduled), needsInput: Boolean(job.approvals?.length || job.controls?.size),
    }));
  }
}

function locksOverlap(a, b) {
  if (a === b) return true;
  if (!a.startsWith('folder:') || !b.startsWith('folder:')) return false;
  const x = a.slice(7).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  const y = b.slice(7).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  return x === y || x.startsWith(y + '/') || y.startsWith(x + '/');
}

class KeyedMutex {
  constructor() { this.tails = new Map(); }
  async run(key, fn) {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    this.tails.set(key, gate);
    await previous;
    try { return await fn(); }
    finally { release(); if (this.tails.get(key) === gate) this.tails.delete(key); }
  }
}

module.exports = { RunPool, locksOverlap, KeyedMutex };
