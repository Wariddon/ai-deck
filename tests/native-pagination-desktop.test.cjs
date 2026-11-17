const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");

test("refresh and a single reply preserve older messages and the next unvisited cursor", { timeout: 35000, skip: process.platform !== "win32" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-native-pagination-")); let passed = false;
  try {
    await promisify(execFile)(require("electron"), [path.join(__dirname, "fixtures/chat-isolation.cjs")], {
      windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_APP: path.resolve(__dirname, "../desktop"), AI_DECK_QA_ROOT: root,
        AI_DECK_QA_PHASE: "first", AI_DECK_QA_PAGINATION: "1" },
    });
    const report = JSON.parse(fs.readFileSync(path.join(root, "first.json"), "utf8"));
    assert.equal(report.error, undefined, report.error); assert.equal(report.passed, true);
    assert.deepEqual(report.pagination, { first: 16, loaded: 48, afterRefresh: 32, afterSend: 50, calls: 1 });
    passed = true;
  } finally {
    if (passed && fs.realpathSync(root) === root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true });
  }
});
