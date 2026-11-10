const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { splitFilePatch, undoGuards, verifyUndoGuards, inversePreview } = require("../desktop/linked-transfer.cjs");
const { statusEntries, testCommand, testReports, reviewTestChecks } = require("../desktop/delivery.cjs");
const { restoreWorkspace } = require("../desktop/run-history.cjs");
const { workspaceView } = require("../desktop/tasks.cjs");

test("only a uniquely identifiable applied hunk can survive later changes nearby", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-undo-test-"));
  const file = path.join(root, "example.txt");
  t.after(() => { fs.rmSync(file, { force: true }); fs.rmdirSync(root); });
  const patch = splitFilePatch("example.txt", [
    "diff --git a/example.txt b/example.txt", "--- a/example.txt", "+++ b/example.txt",
    "@@ -1,3 +1,3 @@", " anchor", "-old", "+applied", " context", "",
  ].join("\n"));
  const write = (text) => fs.writeFileSync(file, text);
  write("anchor\napplied\ncontext\n");
  const guards = undoGuards(root, [patch]);
  write("anchor\napplied\ncontext\nanother edit\n");
  verifyUndoGuards(root, [patch], guards);
  write("anchor\napplied\ncontext\nanchor\napplied\ncontext\n");
  assert.throws(() => verifyUndoGuards(root, [patch], guards), /applied lines or file changed/);
  write("anchor\nlater overlap\ncontext\n");
  assert.throws(() => verifyUndoGuards(root, [patch], guards), /applied lines or file changed/);
  assert.match(inversePreview(patch), /--- a\/example.txt\n\+\+\+ b\/example.txt\n@@ -1,3 \+1,3 @@\n anchor\n\+old\n-applied/);
});

test("delivery distinguishes staging and freshness without inferring a Claude exit code", () => {
  assert.deepEqual(statusEntries("MM staged.txt\0?? an untracked file\0M  unfinished", 200), {
    entries: [
      { index: "M", worktree: "M", file: "staged.txt" },
      { index: "?", worktree: "?", file: "an untracked file" },
    ], truncated: true,
  });
  assert.equal(testCommand('powershell.exe -Command "npm.cmd run test:unit"'), true);
  assert.equal(testCommand("rg pytest"), false);
  const checkout = { cwd: process.cwd(), head: "head", branch: "main", stamp: "verified" };
  const command = (id, subject, observation) => ({ id, kind: "command", agent: "claude", status: "returned", subject, checkout: observation });
  const results = testReports([{ id: "run", evidence: [
    command("missing", "npm test"), command("different-lane", "pytest", { ...checkout, cwd: path.dirname(checkout.cwd) }),
    command("stale", "go test ./...", { ...checkout, stamp: "previous" }), command("matched", "node --test", checkout),
    command("skip", "git status", checkout),
  ] }], checkout);
  assert.deepEqual(results.map(({ freshness }) => freshness), ["matched", "changed", "other", "unknown"]);
  assert.ok(results.every(({ exitCode }) => exitCode === undefined));
  const checks = reviewTestChecks({ id: "run", evidence: [
    { ...command("stale", "npm test", { ...checkout, stamp: "previous" }), output: "Old result" },
    { ...command("matched", "node --test", checkout), exitCode: 0, output: "1 passed" },
  ] }, checkout);
  assert.deepEqual(checks.map(({ freshness, output }) => [freshness, output]), [
    ["matched", "1 passed"], ["changed", undefined],
  ]);
});

test("restart marks open turns interrupted and keeps inverse patches out of renderer state", () => {
  const run = { id: "run", finishedAt: null, agents: { codex: { status: "running" } } };
  const task = { id: "task", runHistory: [run], queue: [], linkedUndo: { patches: [{ text: "local patch" }] } };
  const workspace = restoreWorkspace({ currentTask: task.id, tasks: [task] });
  const view = workspaceView(workspace);
  assert.equal(view.runHistory[0].recoveredAfterRestart, true);
  assert.equal(view.runHistory[0].agents.codex.status, "interrupted");
  assert.equal(view.canUndoLinkedApply, true);
  assert.equal(view.linkedUndo, undefined);
});
