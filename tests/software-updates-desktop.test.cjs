const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");
test("update bell persists read versions and fits desktop layouts without opening untrusted URLs", { timeout: 40000, skip: process.platform !== "win32" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-update-bell-")); let passed = false;
  try {
    for (const restore of ["0", "1"]) {
      await promisify(execFile)(require("electron"), [path.join(__dirname, "fixtures/software-updates.cjs")], {
        windowsHide: true, timeout: 18000, maxBuffer: 1024 * 1024,
        env: { ...process.env, AI_DECK_QA_ROOT: root, AI_DECK_QA_APP: path.resolve(__dirname, "../desktop"), AI_DECK_QA_RESTORE: restore },
      });
      const report = JSON.parse(fs.readFileSync(path.join(root, restore === "1" ? "restored.json" : "result.json"), "utf8"));
      assert.equal(report.error, undefined); assert.equal(report.passed, true);
    }
    passed = true;
  } finally {
    if (passed && fs.realpathSync(root) === root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true });
  }
});
