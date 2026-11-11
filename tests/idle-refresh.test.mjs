import test from "node:test";
import assert from "node:assert/strict";
import { idleRefresh } from "../src/idle-refresh.mjs";

function clock() {
  let now = 0, id = 0;
  const jobs = new Map();
  return {
    set(fn, delay) { jobs.set(++id, { fn, at: now + delay }); return id; },
    clear(key) { jobs.delete(key); },
    advance(ms) { now += ms; for (const [key, job] of jobs) if (job.at <= now) { jobs.delete(key); job.fn(); } },
    get pending() { return jobs.size; },
  };
}

test("automatic metadata reads wait for typing to stop and coalesce repeated focus requests", () => {
  const timer = clock();
  let reads = 0;
  const idle = idleRefresh(() => reads++, { delay: 30, set: timer.set, clear: timer.clear });
  idle.request(); timer.advance(20); idle.activity(); timer.advance(20); idle.request(); idle.activity();
  timer.advance(29); assert.equal(reads, 0); assert.equal(timer.pending, 1);
  timer.advance(1); assert.equal(reads, 1);
  idle.activity(); timer.advance(100); assert.equal(reads, 1);
});

test("leaving a view cancels its pending metadata refresh", () => {
  const timer = clock();
  let reads = 0;
  const idle = idleRefresh(() => reads++, { delay: 30, set: timer.set, clear: timer.clear });
  idle.request(); idle.dispose(); idle.request(); idle.activity(); timer.advance(100);
  assert.equal(timer.pending, 0); assert.equal(reads, 0);
});
