const assert = require("node:assert/strict");
const { test } = require("node:test");
const { newRun, recordEvent, recordSteer, restoreWorkspace } = require("../desktop/run-history.cjs");
const { newTask, ensureTasks, workspaceView, canDrain } = require("../desktop/tasks.cjs");

test("legacy projects restore worktree, provider sessions and history to the first task", () => {
  const run = newRun("team", "Fix the retry guard", ["codex", "claude"]);
  const workspace = ensureTasks(restoreWorkspace({
    repo: "fixture", worktree: "existing-worktree", base: "existing-base",
    codexThread: "codex-thread", claudeSession: "claude-session",
    usage: { codex: { total: 12 } }, runHistory: [run], notes: [{ name: "Shared notes" }],
  }));
  const first = workspaceView(workspace);
  assert.equal(first.title, run.prompt);
  assert.equal(first.worktree, "existing-worktree");
  assert.equal(first.base, "existing-base");
  assert.equal(first.codexThread, "codex-thread");
  assert.equal(first.claudeSession, "claude-session");
  assert.equal(first.usage.codex.total, 12);
  assert.equal(first.runHistory[0].agents.claude.status, "interrupted");
  assert.equal(ensureTasks(workspace).currentTask, first.taskId);

  const second = newTask();
  workspace.tasks.push(second);
  workspace.currentTask = second.id;
  const current = workspaceView(workspace);
  assert.equal(current.worktree, null);
  assert.equal(current.codexThread, undefined);
  assert.deepEqual(current.runHistory, []);
  assert.deepEqual(current.queue, []);
  assert.deepEqual(current.notes, first.notes);
  assert.equal(current.tasks[0].runs, 1);
});

test("a shared run keeps final message references, accepted steering and limits in order", () => {
  const run = newRun("team", "Check retry", ["codex", "claude"]);
  recordEvent(run, "claude", { type: "message", key: "claude-1", text: "Review started" });
  recordSteer(run, "queue-1", "Check simultaneous requests");
  recordEvent(run, "codex", { type: "message", key: "codex-1", text: "Work in progress" });
  recordEvent(run, "codex", { type: "message", key: "codex-1", text: "Patched" });
  recordEvent(run, "claude", { type: "limit", limit: { resetAt: null } });
  assert.deepEqual(run.timeline.map(({ agent, kind }) => [agent, kind]), [
    ["claude", "message"], ["codex", "steer"], ["codex", "message"], ["claude", "limit"],
  ]);
  assert.equal(run.agents.codex.messages[0].text, "Patched");
});

test("a limited, stopped or failed team turn leaves its queue paused", () => {
  const run = newRun("team", "Check retry", ["codex", "claude"]);
  run.agents.codex.status = "completed";
  for (const status of ["limited", "interrupted", "failed", "running", "queued"]) {
    run.agents.claude.status = status;
    assert.equal(canDrain(run, false, false), false);
  }
  run.agents.claude.status = "completed";
  assert.equal(canDrain(run, true, false), false);
  assert.equal(canDrain(run, false, true), false);
  assert.equal(canDrain(run, false, false), true);
});
