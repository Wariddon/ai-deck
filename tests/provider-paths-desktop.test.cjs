const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");

test("a verified packaged Claude path survives restart after local defaults disappear", { timeout: 45000, skip: process.platform !== "win32" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-provider-paths-")); let passed = false;
  try {
    for (const phase of ["first", "restore"]) {
      await promisify(execFile)(require("electron"), [path.join(__dirname, "fixtures/chat-isolation.cjs")], {
        windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024,
        env: { ...process.env, AI_DECK_QA_APP: path.resolve(__dirname, "../desktop"), AI_DECK_QA_ROOT: root,
          AI_DECK_QA_PHASE: phase, AI_DECK_QA_PATH_RECOVERY: "1" },
      });
      const report = JSON.parse(fs.readFileSync(path.join(root, phase + ".json"), "utf8"));
      assert.equal(report.error, undefined, report.error); assert.equal(report.pathRetained, true);
      assert.equal(report.calls.length, 0);
    }
    passed = true;
  } finally {
    if (passed && fs.realpathSync(root) === root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true });
  }
});
