const assert = require("node:assert/strict");
const { test } = require("node:test");
const { nextOccurrence, scheduleInput, claim, restoreSchedule, resultStatus } = require("../desktop/scheduled.cjs");

const local = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const draft = {
  name: "Check queue", prompt: "Summarize the latest test failures.", repo: "repo",
  cadence: "weekdays", time: "09:00", day: 1, mode: "team", access: "read", fallback: "wait",
};

test("local weekday and weekly schedules advance past the current occurrence", () => {
  assert.equal(nextOccurrence(draft, local(6, 8)), local(6, 9));
  assert.equal(nextOccurrence(draft, local(6, 9)), local(9, 9));
  assert.equal(nextOccurrence({ ...draft, cadence: "weekly" }, local(9, 9)), local(16, 9));
});

test("new schedules start paused and validate write modes and input", () => {
  const schedule = scheduleInput(draft, true, undefined, local(6, 8));
  assert.equal(schedule.enabled, false);
  assert.equal(schedule.nextAt, null);
  assert.throws(() => scheduleInput(draft, false), /known project/u);
  assert.throws(() => scheduleInput({ ...draft, mode: "claude-write" }, true), /write access/u);
  assert.throws(() => scheduleInput({ ...draft, time: "25:00" }, true), /local time/u);
});

test("each occurrence is claimed once, manual runs leave the cadence intact, and restart skips old occurrences", () => {
  const schedule = { ...scheduleInput(draft, true), enabled: true, nextAt: local(6, 9) };
  assert.equal(claim(schedule, false, local(6, 8)), null);
  const started = claim(schedule, false, local(6, 9));
  assert.equal(started.nextAt, local(9, 9));
  assert.equal(started.runs[0].occurrence, local(6, 9));
  assert.equal(claim(started, false, local(6, 9)), null);
  const manual = claim(started, true, local(6, 10));
  assert.equal(manual.nextAt, local(9, 9));
  assert.equal(manual.runs[0].occurrence, null);
  assert.equal(restoreSchedule(manual, local(9, 10)).nextAt, local(10, 9));
  assert.equal(restoreSchedule(manual, local(9, 10)).runs[0].status, "interrupted");
  assert.equal(resultStatus({ agents: { codex: { status: "completed" }, claude: { status: "limited" } } }), "partial");
});

test("a scheduled team plan stops at approval and normalizes access to read-only", () => {
  const schedule = scheduleInput({ ...draft, mode: "claude-plan-codex", access: "write", fallback: "available" }, true);
  assert.equal(schedule.access, "read");
  assert.equal(schedule.fallback, "wait");
  assert.equal(resultStatus({ teamPlan: { state: "ready" } }), "awaiting approval");
  assert.equal(resultStatus({ teamPlan: { state: "needs-input" } }), "needs input");
});

test("usage-held occurrences survive restart and resume with the same id", () => {
  const { waitingRun, waitingStatus } = require("../desktop/scheduled.cjs");
  const first = local(6, 9);
  const schedule = { ...scheduleInput(draft, true), enabled: true, nextAt: first };
  const claimed = claim(schedule, false, first);
  claimed.runs[0].status = waitingStatus;
  const after = local(10, 11);
  const restored = restoreSchedule(claimed, after);
  assert.equal(waitingRun(restored).id, claimed.runs[0].id);
  assert.throws(() => scheduleInput(draft, true, restored), /Cancel the waiting run/);
  const resumed = claim(restored, false, after);
  assert.equal(resumed.runs.length, 1);
  assert.equal(resumed.runs[0].id, claimed.runs[0].id);
  assert.equal(resumed.runs[0].occurrence, first);
  assert.equal(resumed.runs[0].status, "starting");
  assert.ok(resumed.nextAt > after);
  assert.equal(claim({ ...restored, enabled: false, nextAt: null }, false, after), null);
  assert.equal(claim({ ...restored, enabled: false, nextAt: null }, true, after).runs[0].id, claimed.runs[0].id);
});
