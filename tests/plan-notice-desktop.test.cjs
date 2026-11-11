const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");
test("saved plan notes stay nonblocking, preserve drafts and allow both providers after restart", { timeout: 50000, skip: process.platform !== "win32" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-plan-note-")); let passed = false;
  try {
    for (const restore of ["0", "1"]) {
      await promisify(execFile)(require("electron"), [path.join(__dirname, "fixtures/plan-notice.cjs")], {
        windowsHide: true, timeout: 22000, maxBuffer: 1024 * 1024,
        env: { ...process.env, AI_DECK_QA_ROOT: root, AI_DECK_QA_APP: path.resolve(__dirname, "../desktop"), AI_DECK_QA_RESTORE: restore },
      });
      const result = JSON.parse(fs.readFileSync(path.join(root, restore === "1" ? "restored.json" : "result.json"), "utf8"));
      assert.equal(result.error, undefined, result.error + " " + root); assert.equal(result.passed, true);
    }
    passed = true;
  } finally { if (passed && fs.realpathSync(root) === root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true }); }
});
