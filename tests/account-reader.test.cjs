const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { createAccountReader, accountQuotaSnapshot } = require("../desktop/account-reader.cjs");

test("account quota snapshots retain the reported plan without carrying private account fields", () => {
  const windows = [{ id: "codex:secondary", usedPercent: 71 }];
  const snapshot = accountQuotaSnapshot({ windows, fetchedAt: 123, plan: "prolite", accountId: "private", email: "private", credits: {} });
  assert.deepEqual(snapshot, { windows, fetchedAt: 123, plan: "prolite" });
  assert.deepEqual(accountQuotaSnapshot({ fetchedAt: 124, plan: null }), { windows: [], fetchedAt: 124 });
  assert.deepEqual(accountQuotaSnapshot({ fetchedAt: 125, plan: { name: "invalid" } }), { windows: [], fetchedAt: 125 });
});

test("Simultaneous account refreshes share one read and release it for later refreshes", async () => {
  let calls = 0;
  const reader = createAccountReader(async (agent) => { calls++; await delay(5); return { agent }; });
  const first = reader.read("claude");
  assert.equal(first, reader.read("claude"));
  assert.equal(reader.pending, true);
  assert.deepEqual(await first, { agent: "claude" });
  assert.equal(reader.pending, false);
  await reader.read("claude");
  assert.equal(calls, 2);
});

test("A stalled account check times out without a model call or a permanent busy state", async () => {
  const reader = createAccountReader((_agent, signal) => delay(30000, null, { signal }), { timeout: 15 });
  await assert.rejects(reader.read("claude"), /timed out/);
  assert.equal(reader.pending, false);
});

test("Foreground actions cancel all account readers and a subsequent refresh is independent", async () => {
  let calls = 0;
  const reader = createAccountReader(async (_agent, signal) => { calls++; await delay(calls < 3 ? 30000 : 1, null, { signal }); return "ready"; });
  const pending = [reader.read("codex"), reader.read("claude")];
  await delay(1);
  reader.abort();
  const result = await Promise.allSettled(pending);
  assert.ok(result.every((entry) => entry.status === "rejected" && /cancelled/.test(entry.reason.message)));
  assert.equal(reader.pending, false);
  assert.equal(await reader.read("claude"), "ready");
});
