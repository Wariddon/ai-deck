import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createThumbnailLoader } from "../src/attachment-thumbnails.mjs";

test("thumbnail reads coalesce, cache recent images, and keep decoding concurrency bounded", async () => {
  let active = 0, peak = 0, calls = 0;
  const loader = createThumbnailLoader(async (id) => {
    calls++; active++; peak = Math.max(peak, active);
    await delay(3); active--;
    return "data:image/png;base64," + id;
  }, { concurrency: 2, limit: 2 });
  const first = loader.read("a");
  assert.equal(first, loader.read("a"));
  await Promise.all([first, loader.read("b"), loader.read("c")]);
  assert.equal(peak, 2);
  assert.equal(calls, 3);
  assert.equal(await loader.read("c"), "data:image/png;base64,c");
  assert.equal(calls, 3);
  await loader.read("a");
  assert.equal(calls, 4);
  loader.dispose();
});

test("closing a task cancels queued thumbnails and never retains late results", async () => {
  let complete;
  let calls = 0;
  const loader = createThumbnailLoader(() => { calls++; return new Promise((resolve) => { complete = resolve; }); }, { concurrency: 1 });
  const settled = Promise.allSettled([loader.read("a"), loader.read("b")]);
  await delay(0);
  loader.dispose();
  complete("late");
  assert.ok((await settled).every((entry) => entry.status === "rejected"));
  assert.equal(calls, 1);
  await assert.rejects(loader.read("c"), /closed/);
});

test("a failed preview can be retried without leaving a rejected promise cached", async () => {
  let calls = 0;
  const loader = createThumbnailLoader(async () => { if (++calls === 1) throw new Error("missing"); return "ready"; });
  await assert.rejects(loader.read("a"), /missing/);
  await delay(0);
  assert.equal(await loader.read("a"), "ready");
  loader.dispose();
});
