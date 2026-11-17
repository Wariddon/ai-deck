const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { createRecentLoader } = require("../desktop/recent-loader.cjs");
const { capture } = require("../desktop/engines.cjs");

test("Recents coalesces reads and caches metadata without losing a failed provider's chats", async () => {
  const cache = new Map([["claude:old", { provider: "claude", id: "old", updatedAt: 1 }]]);
  let count = 0;
  let now = 100;
  const loader = createRecentLoader({ cache, now: () => now, ttl: 60, readers: {
    codex: async () => { count++; await delay(5); return [{ provider: "codex", id: "new", updatedAt: 2 }]; },
    claude: async () => { throw new Error("History unavailable"); },
  } });
  const first = loader.refresh();
  assert.equal(loader.pending, true);
  assert.equal(first, loader.refresh());
  const result = await first;
  assert.deepEqual(result.sessions.map(({ id }) => id), ["new", "old"]);
  assert.equal(result.errors.claude, "History unavailable");
  assert.equal(loader.pending, false);
  await loader.refresh();
  assert.equal(count, 1);
  now += 61;
  await loader.refresh();
  assert.equal(count, 2);
  await loader.refresh({ force: true });
  assert.equal(count, 3);
});

test("Foreground work cancels Recents without publishing partial results or errors", async () => {
  const cache = new Map([["codex:saved", { provider: "codex", id: "saved" }]]);
  let blocked = false;
  let calls = 0;
  const loader = createRecentLoader({ cache, blocked: () => blocked, readers: {
    codex: async (signal) => { calls++; await delay(10000, null, { signal }); return []; },
    claude: async () => [{ provider: "claude", id: "partial" }],
  } });
  const read = loader.refresh();
  loader.cancel();
  blocked = true;
  const canceled = await read;
  assert.equal(canceled.deferred, true);
  assert.deepEqual(canceled.errors, {});
  assert.deepEqual([...cache.keys()], ["codex:saved"]);
  const deferred = await loader.refresh();
  assert.equal(deferred.deferred, true);
  assert.equal(calls, 0, 'Cancellation before dispatch must not start a metadata reader');
});

test("A slow provider times out while the successful provider's chats stay available", async () => {
  const loader = createRecentLoader({ cache: new Map(), timeout: 20, readers: {
    codex: async (signal) => { await delay(10000, null, { signal }); return []; },
    claude: async () => [{ provider: "claude", id: "ready" }],
  } });
  const result = await loader.refresh();
  assert.equal(result.sessions[0].id, "ready");
  assert.ok(result.errors.codex);
  assert.equal(loader.pending, false);
});

test("Connection command cancellation stops a stalled child instead of waiting for its own timeout", async () => {
  const controller = new AbortController();
  const pending = capture(process.execPath, ["-e", "setTimeout(()=>{},30000)"], { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.throws(() => capture(process.execPath, ["--version"], { signal: controller.signal }), { name: "AbortError" });
});

test('Recents settles on its deadline even when a reader ignores abort and retains the last known rows', async () => {
  const cache = new Map([['codex:saved', { provider: 'codex', id: 'saved', updatedAt: 1 }]]); let release;
  const loader = createRecentLoader({ cache, timeout: 10, readers: {
    codex: () => new Promise(resolve => { release = resolve; }),
    claude: async () => [{ provider: 'claude', id: 'ready', updatedAt: 2 }],
  } });
  let settled = false; const pending = loader.refresh().then(result => { settled = true; return result; });
  await delay(100); const endedWithinBudget = settled;
  release([{ provider: 'codex', id: 'late', updatedAt: 3 }]); const result = await pending;
  assert.equal(endedWithinBudget, true); assert.equal(loader.pending, false);
  assert.deepEqual(result.sessions.map(row => row.id), ['ready', 'saved']); assert.ok(result.errors.codex);
  assert.equal(cache.has('codex:late'), false);
});
