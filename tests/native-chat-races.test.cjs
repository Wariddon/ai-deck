const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { test } = require("node:test");

test("native chat preserves new drafts, shares metadata reads and isolates waiting controls", {
  timeout: 45000, skip: process.platform !== "win32" ? "Windows desktop integration" : false,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-native-races-"));
  const report = path.join(root, "result.json");
  let passed = false;
  try {
    await promisify(execFile)(require("electron"), [path.join(__dirname, "fixtures", "native-chat-races.cjs")], {
      cwd: path.resolve(__dirname, ".."), windowsHide: true, timeout: 40000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_ROOT: root, AI_DECK_QA_APP: path.resolve(__dirname, "../desktop"), AI_DECK_QA_RESTORE: "0" },
    });
    const result = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.passed, true, "Native chat regression failed: " + report);
    assert.equal(result.checks.length, 6);
    assert.equal(result.calls.length, 3);
    assert.ok(result.calls.every((call) => call.provider === "codex" && call.permissionMode === "chat"));
    passed = true;
  } finally {
    if (passed && fs.realpathSync(root) === root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
  }
});
