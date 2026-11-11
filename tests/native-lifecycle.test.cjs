const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFile } = require('node:child_process'), { promisify } = require('node:util'), { test } = require('node:test');
test('delayed native imports preserve reopened drafts and hidden or revoked window shares stay closed', { timeout: 45000, skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-native-lifecycle-')); let passed = false;
  try {
    await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/native-lifecycle.cjs')], { windowsHide: true, timeout: 40000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_APP: path.resolve(__dirname, '../desktop'), AI_DECK_QA_ROOT: root, AI_DECK_QA_RESTORE: '0' } });
    const report = JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8'));
    assert.equal(report.error, undefined, report.error); assert.equal(report.passed, true);
    assert.equal(report.calls.length, 4); assert.equal(report.checks.length, 6);
    passed = true;
  } finally { if (passed) { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); } }
});
