const test = require("node:test");
const assert = require("node:assert/strict");
const { taskSummary, taskAttention } = require("../desktop/tasks.cjs");
const { retainRuns } = require("../desktop/run-history.cjs");

test("pending plans stay in their original chat after newer completed turns", () => {
  const plan = { id: "saved-plan", finishedAt: "2026-11-10T00:00:00Z", teamPlan: { state: "ready" }, agents: {} };
  const history = [plan, ...Array.from({ length: 30 }, (_, index) => ({ id: "done-" + index, finishedAt: "2026-11-11T00:00:00Z", agents: {} }))];
  const task = { id: "chat", title: "Original chat", queue: [], runHistory: history };
  task.runHistory = retainRuns(history.slice(0, -1), history.at(-1));
  assert.ok(task.runHistory.some(run => run.id === plan.id));
  const before = JSON.stringify(task);
  assert.deepEqual(taskSummary(task).attention, { label: "Saved plan awaiting a decision", runId: plan.id });
  assert.equal(JSON.stringify(task), before);
  plan.teamPlan.applyStatus = "dismissed";
  assert.equal(taskAttention(task), undefined);
});

test("task attention stays local and distinguishes pending reviews, paused queues, archived and running chats", () => {
  const task = { queue: [], runHistory: [{ id: "review", finishedAt: "now", reviewPending: true, agents: {} }] };
  assert.deepEqual(taskAttention(task), { label: "Review pending", runId: "review" });
  assert.equal(taskAttention({ ...task, archivedAt: "now" }), undefined);
  assert.equal(taskAttention({ ...task, runHistory: [...task.runHistory, { id: "working", finishedAt: null }] }), undefined);
  assert.deepEqual(taskAttention({ queuePaused: true, queue: [{}], runHistory: [] }), { label: "Queue paused" });
  assert.equal(taskAttention({ queuePaused: false, queue: [{}], runHistory: [] }), undefined);
});
