const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");

test("shared team guidance reaches both provider role orders, Session Team and Auto Team without extra turns", {
  timeout: 110000, skip: process.platform !== "win32",
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-team-skills-")); let passed = false;
  try {
    await promisify(execFile)(require("electron"), [path.join(__dirname, "fixtures/team-skills.cjs")], {
      windowsHide: true, timeout: 85000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_APP: path.resolve(__dirname, "../desktop"), AI_DECK_QA_ROOT: root },
    });
    const report = JSON.parse(fs.readFileSync(path.join(root, "result.json"), "utf8"));
    assert.equal(report.error, undefined, report.error); assert.equal(report.passed, true);
    assert.equal(report.cases.length, 12);
    assert.equal(report.calls.length, 24);
    for (const result of report.cases) assert.equal(result.turns, 2);
    await promisify(execFile)(require("electron"), [path.join(__dirname, "fixtures/team-skills.cjs")], {
      windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_APP: path.resolve(__dirname, "../desktop"), AI_DECK_QA_ROOT: root, AI_DECK_QA_RESTORE: "1" },
    });
    const restored = JSON.parse(fs.readFileSync(path.join(root, "result.json"), "utf8"));
    assert.equal(restored.error, undefined, restored.error);
    assert.equal(restored.restarted, true);
    assert.equal(restored.calls.length, 24);
    passed = true;
  } finally {
    if (passed && fs.realpathSync(root) === root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true });
  }
});
