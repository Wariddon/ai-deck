const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");

test("chat switches isolate model settings and drafts across late saves, replies, duplicate submits and restart", {
  timeout: 65000, skip: process.platform !== "win32",
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-chat-isolation-")); let passed = false;
  try {
    for (const phase of ["first", "restore"]) {
      await promisify(execFile)(require("electron"), [path.join(__dirname, "fixtures/chat-isolation.cjs")], {
        windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
        env: { ...process.env, AI_DECK_QA_APP: path.resolve(__dirname, "../desktop"), AI_DECK_QA_ROOT: root, AI_DECK_QA_PHASE: phase },
      });
      const report = JSON.parse(fs.readFileSync(path.join(root, phase + ".json"), "utf8"));
      assert.equal(report.error, undefined, report.error); assert.equal(report.passed, true);
      assert.equal(report.calls.length, phase === "first" ? 3 : 0, "No automatic sends on restoration");
      assert.equal(report.legacyDrafts, 20);
      if (phase === "first") assert.equal(report.burstWrites, 1, "Typing does not synchronously rewrite every chat's draft for every key");
      assert.ok(report.checks.includes("task settings and drafts stay separate"));
    }
    passed = true;
  } finally {
    if (passed && fs.realpathSync(root) === root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true });
  }
});
