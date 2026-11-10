import assert from "node:assert/strict";
import test from "node:test";
import { quotaBadgeWindow } from "../desktop/usage-routing.mjs";

const now = 1_800_000_000_000;
const report = (id, usedPercent, resetAt = now + 60_000, observedAt = now - 100) =>
  ({ id, name: id, usedPercent, resetAt, observedAt });

test("the quota badge selects the fullest active account window instead of expired or model buckets", () => {
  const accountQuota = { fetchedAt: now - 100, windows: [
    report("codex:primary", 31), report("codex:secondary", 42), report("codex:expired", 100, now - 1),
    report("other-model:primary", 90),
  ] };
  assert.equal(quotaBadgeWindow("codex", { status: "ready", accountQuota }, now).usedPercent, 42);
  assert.equal(quotaBadgeWindow("codex", { status: "ready", accountQuota }, now + 60_000), null);
});

test("new reported percentages supersede older observations while retaining both account windows", () => {
  const accountQuota = { fetchedAt: now - 100, windows: [report("codex:primary", 31), report("codex:secondary", 42)] };
  const quota = [report("codex:primary", 75, now + 60_000, now), report("codex:secondary", 99, now + 60_000, now - 200)];
  assert.equal(quotaBadgeWindow("codex", { status: "ready", accountQuota, quota }, now).usedPercent, 75);
  const claude = { status: "ready", accountQuota: { fetchedAt: now - 100, windows: [
    report("weekly_all:0", 64), report("weekly_scoped:1", 30),
  ] } };
  assert.equal(quotaBadgeWindow("claude", claude, now).usedPercent, 64);
});

test("unknown, disconnected, expired and API usage remain unknown while a reported zero is valid", () => {
  const quota = [report("reported", 0)];
  assert.equal(quotaBadgeWindow("claude", { status: "ready", quota }, now).usedPercent, 0);
  assert.equal(quotaBadgeWindow("claude", { status: "ready", authMethod: "apiKey", quota }, now), null);
  assert.equal(quotaBadgeWindow("claude", { status: "signIn", quota }, now), null);
  assert.equal(quotaBadgeWindow("claude", { status: "ready", quota: [report("reported", null)] }, now), null);
  assert.equal(quotaBadgeWindow("claude", { status: "ready",
    quota: [report("reported", 80, null, now - 31 * 60_000)] }, now), null);
});
