const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");

test("one-click forks preserve sources, choose verified projects and allow all permissions or no-Git conversation", { timeout: 65000, skip: process.platform !== "win32" }, async () => {
  for (const noProject of ["0", "1"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-quick-fork-")); let passed = false;
    try {
      await promisify(execFile)(require("electron"), [path.join(__dirname, "fixtures/quick-fork.cjs")], {
        windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
        env: { ...process.env, AI_DECK_QA_APP: path.resolve(__dirname, "../desktop"), AI_DECK_QA_ROOT: root, AI_DECK_QA_NO_PROJECT: noProject },
      });
      const report = JSON.parse(fs.readFileSync(path.join(root, "result.json"), "utf8"));
      assert.equal(report.error, undefined, report.error); assert.equal(report.passed, true);
      assert.equal(report.authFailureHandled, true);
      assert.equal(report.forks.length, 6); passed = true;
    } finally {
      if (passed && fs.realpathSync(root) === root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true });
    }
  }
});
