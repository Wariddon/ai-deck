const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFile } = require('node:child_process'), { promisify } = require('node:util'), { test } = require('node:test');
test('original Codex and Claude chats send attachments once and keep their native IDs', { timeout: 45000, skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-native-files-'));
  let passed = false;
  try {
    await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/native-attachments.cjs')], {
      windowsHide: true, timeout: 40000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_APP: path.resolve(__dirname, '../desktop'), AI_DECK_QA_ROOT: root, AI_DECK_QA_RESTORE: '0' },
    });
    const report = JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8'));
    assert.equal(report.error, undefined, report.error);
    assert.equal(report.passed, true);
    assert.equal(report.calls.length, 4);
    assert.deepEqual(report.calls.map(call => call.id), [report.ids.codex, report.ids.claude, report.ids.codex, report.ids.claude]);
    await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/native-attachments.cjs')], { windowsHide: true, timeout: 40000, maxBuffer: 1024 * 1024, env: { ...process.env, AI_DECK_QA_APP: path.resolve(__dirname, '../desktop'), AI_DECK_QA_ROOT: root, AI_DECK_QA_RESTORE: '1' } });
    const restored=JSON.parse(fs.readFileSync(path.join(root,'restore-result.json'),'utf8'));assert.equal(restored.error,undefined,restored.error);assert.equal(restored.passed,true);assert.equal(restored.calls.length,0);
    passed = true;
  } finally { if (passed) { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); } }
});
