const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");

test("typing in a loaded long original chat reuses history and sends no provider turn", {
  timeout: 45000, skip: process.platform !== "win32",
}, async () => {
  const root = process.env.AI_DECK_QA_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-native-performance-")); let passed = false;
  try {
    await promisify(execFile)(require("electron"), [path.join(__dirname, "fixtures/chat-isolation.cjs")], {
      windowsHide: true, timeout: 40000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_APP: process.env.AI_DECK_QA_APP || path.resolve(__dirname, "../desktop"), AI_DECK_QA_ROOT: root,
        AI_DECK_QA_PHASE: "first", AI_DECK_QA_PERFORMANCE: "1" },
    });
    const report = JSON.parse(fs.readFileSync(path.join(root, "first.json"), "utf8"));
    assert.equal(report.error, undefined, report.error); assert.equal(report.passed, true);
    assert.equal(report.calls.length, 0);
    if (process.env.AI_DECK_QA_ALLOW_HISTORY_REBUILD !== "1") assert.equal(report.performance.passes, 0);
    passed = true;
  } finally {
    if (passed && !process.env.AI_DECK_QA_ROOT && fs.realpathSync(root) === root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true });
  }
});
