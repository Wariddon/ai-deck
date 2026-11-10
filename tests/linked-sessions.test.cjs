const test = require("node:test");
const assert = require("node:assert/strict");
const { linkedResume, linkedContext, sameLinkedTarget } = require("../desktop/linked-sessions.cjs");

test("linked sessions preserve native IDs and fork only the original provider of a copy", () => {
  const source = { provider: "claude", id: "original" };
  assert.deepEqual(linkedResume({ source, folderMode: "original", refs: { claude: "original" } }, "claude"),
    { id: "original", fork: false });
  assert.deepEqual(linkedResume({ source, folderMode: "copy", refs: {} }, "claude"),
    { id: "original", fork: true });
  assert.deepEqual(linkedResume({ source, folderMode: "copy", refs: { claude: "child" } }, "claude"),
    { id: "child", fork: false });
  assert.deepEqual(linkedResume({ source, folderMode: "copy", refs: {} }, "codex"),
    { id: undefined, fork: false });
});

test("switching providers quotes only new messages after a delivered anchor", () => {
  const older = { id: "older", role: "user", text: "Already shared" };
  const reply = { id: "reply", role: "assistant", text: "New result\nSecond line" };
  const link = { delivered: { codex: { revision: "one", anchor: older.id } } };
  assert.equal(linkedContext(link, "codex", { claude: { revision: "one", messages: [older] } }), null);
  const context = linkedContext(link, "codex", { claude: { revision: "two", messages: [reply, older] } });
  assert.deepEqual(context, { provider: "claude", revision: "two", anchor: reply.id, count: 1,
    text: "Claude Code\n> New result\n> Second line" });
});

test("a linked confirmation binds the repository, folder, branch, commit and working changes", () => {
  const target = { repo: "C:/demo", gitDir: "C:/demo/.git", cwd: "C:/demo/sub",
    branch: "main", commit: "abc", status: " M example.js", stamp: "changes" };
  assert.ok(sameLinkedTarget(target, { ...target }));
  for (const key of ["repo", "gitDir", "cwd", "branch", "commit", "status", "stamp"]) {
    assert.equal(sameLinkedTarget(target, { ...target, [key]: target[key] + "-new" }), false);
  }
});
