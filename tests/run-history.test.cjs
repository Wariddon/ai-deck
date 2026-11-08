const assert = require("node:assert/strict");
const { test } = require("node:test");
const { newRun, recordEvent, finishRun, restoreWorkspace } = require("../desktop/run-history.cjs");

test("upgrade preserves previous provider sessions and enables existing MCP entries", () => {
  const workspace = { codexThread: "old-thread", claudeSession: "old-session", plugins: [{ name: "legacy" }] };
  restoreWorkspace(workspace);
  assert.deepEqual(workspace.runHistory, []);
  assert.deepEqual(workspace.plugins, [{ name: "legacy", enabled: true, scope: "both" }]);
  assert.equal(workspace.codexThread, "old-thread");
  assert.equal(workspace.claudeSession, "old-session");
});

test("history replaces message snapshots and saves each provider's reported scope", () => {
  const run = newRun("team", "Check retry", ["codex", "claude"]);
  recordEvent(run, "codex", { type: "delta", key: "1", text: "Partial" });
  recordEvent(run, "codex", { type: "activity", text: "Raw command output" });
  recordEvent(run, "codex", { type: "message", key: "1", text: "Final" });
  recordEvent(run, "codex", { type: "message", key: "1", text: "Replaced" });
  recordEvent(run, "codex", { type: "usage", scope: "Thread total", usage: { total: 12 } });
  recordEvent(run, "claude", { type: "usage", scope: "CLI result", usage: { total: 7 } });
  recordEvent(run, "claude", { type: "status", status: "completed" });
  finishRun(run);
  assert.equal(run.agents.codex.status, "interrupted");
  assert.equal(run.agents.claude.status, "completed");
  assert.deepEqual(run.agents.codex.messages, [{ key: "1", text: "Replaced" }]);
  assert.equal(run.agents.codex.usage.scope, "Thread total");
  assert.equal(run.agents.claude.usage.scope, "CLI result");
  assert.ok(run.finishedAt);
});

test("approval decisions and command results persist separately from model completion", () => {
  const run = newRun("codex", "Check retries", ["codex"]);
  recordEvent(run, "codex", { type: "approval-decision", key: "approval", title: "Command approval", subject: "npm test", accepted: true });
  recordEvent(run, "codex", { type: "command-result", key: "command", command: "npm test", exitCode: 1, status: "failed" });
  recordEvent(run, "codex", { type: "command-result", key: "secret", command: "TOKEN=demo-secret npm test", status: "returned" });
  recordEvent(run, "codex", { type: "status", status: "completed" });
  finishRun(run);
  assert.deepEqual(run.evidence.map(({ kind, status, exitCode }) => [kind, status, exitCode]), [
    ["approval", "allowed", undefined], ["command", "failed", 1], ["command", "returned", undefined],
  ]);
  assert.equal(run.evidence[0].subject, "npm test");
  assert.doesNotMatch(JSON.stringify(run), /demo-secret/);
  assert.equal(run.agents.codex.status, "completed");
});

test("older actionable plans stay in history until implemented or dismissed", () => {
  const { retainRuns } = require("../desktop/run-history.cjs");
  const pending = { id: "pending", teamPlan: { state: "ready" } };
  const dismissed = { id: "dismissed", teamPlan: { state: "ready", applyStatus: "dismissed" } };
  const old = { id: "ordinary" };
  const recent = Array.from({ length: 23 }, (_, index) => ({ id: "recent-" + index }));
  const next = retainRuns([pending, dismissed, old, ...recent], { id: "new" });
  assert.equal(next.length, 25);
  assert.equal(next[0], pending);
  assert.equal(next[1], recent[0]);
  assert.equal(next.at(-1).id, "new");
});

test("task panel records loopback previews and keeps explicit links and sources scoped", () => {
  const { safeLink, localPreviews, recordPanelEvidence, taskRows } = require("../desktop/task-panel.cjs");
  assert.equal(safeLink("file:///C:/private"), null);
  assert.equal(safeLink("https://user:password@example.test"), null);
  assert.deepEqual(localPreviews("Local http://127.0.0.1:4173/ and localhost:3000/app?secret=x, https://example.test/localhost:5555"), [
    "http://127.0.0.1:4173/", "http://localhost:3000/app",
  ]);
  const run = { images: [{ id: "attachment", name: "user.png" }], prompt: "Task\n[Attached text · report.md]\nnotes" };
  const redact = (value) => value;
  assert.equal(recordPanelEvidence(run, "codex", { type: "command-result", output: "Ready http://127.0.0.1:4173/" }, redact), true);
  assert.equal(recordPanelEvidence(run, "codex", { type: "message", text: "http://127.0.0.1:4173/" }, redact), false);
  assert.equal(recordPanelEvidence(run, "claude", { type: "web-source", kind: "search", detail: "test query" }, redact), true);
  const panel = taskRows({ runHistory: [run], panelEntries: [] });
  assert.deepEqual(panel.outputs.map((entry) => entry.name), ["127.0.0.1:4173"]);
  assert.deepEqual(panel.sources.map((entry) => entry.name), ["user.png", "report.md", "Web search"]);
  assert.deepEqual(taskRows({ runHistory: [] }), { outputs: [], sources: [] });
});
