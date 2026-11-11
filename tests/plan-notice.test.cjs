const { test } = require("node:test"), assert = require("node:assert/strict");
const { newTask, hidePlanNotice, taskAttention, workspaceView } = require("../desktop/tasks.cjs");
function task() {
  return { ...newTask(), runHistory: [{ id: "old-plan", finishedAt: "2026-11-11", teamPlan: { state: "blocked", text: "Files are in another project" } }],
    savedDraft: { prompt: "My unfinished message", mode: "parallel-write" } };
}
test("hiding a plan notice clears only its attention and survives state serialization", () => {
  const current = task(), history = JSON.stringify(current.runHistory), draft = JSON.stringify(current.savedDraft);
  assert.equal(taskAttention(current).runId, "old-plan"); hidePlanNotice(current, "old-plan");
  assert.equal(taskAttention(current), undefined); assert.equal(JSON.stringify(current.runHistory), history); assert.equal(JSON.stringify(current.savedDraft), draft);
  const restored = JSON.parse(JSON.stringify(current));
  assert.equal(taskAttention(restored), undefined);
  assert.equal(workspaceView({ tasks: [restored], currentTask: restored.id }).hiddenPlanNoticeId, "old-plan");
  restored.runHistory.push({ ...restored.runHistory[0], id: "new-plan" });
  assert.equal(taskAttention(restored).runId, "new-plan");
});
test("hiding a notice cannot approve a plan, hide a running run or target a different run", () => {
  const current = task();
  for (const id of [undefined, "unrelated"]) assert.throws(() => hidePlanNotice(current, id), /changed/);
  current.runHistory[0].teamPlan.state = "ready";
  assert.throws(() => hidePlanNotice(current, "old-plan"), /changed/);
  assert.equal(taskAttention(current).label, "Saved plan awaiting a decision");
  current.runHistory[0].teamPlan.state = "blocked"; delete current.runHistory[0].finishedAt;
  assert.throws(() => hidePlanNotice(current, "old-plan"), /changed/);
  assert.equal(current.hiddenPlanNoticeId, undefined);
});
