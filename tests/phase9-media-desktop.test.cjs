const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
test('voice task, project, minimize and cancel races stay isolated through production IPC', { timeout: 50000, skip: process.platform !== 'win32' }, async () => {
  const root = process.env.AI_DECK_QA_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'deck-phase9-media-'));
  let passed = false;
  try {
    await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/phase9-media.cjs')], {
      windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_ROOT: root, AI_DECK_QA_APP: process.env.AI_DECK_QA_APP || path.resolve(__dirname, '../desktop') },
    });
    const result = JSON.parse(fs.readFileSync(path.join(root, 'result.json')));
    assert.equal(result.error, undefined, result.error + ' ' + root);
    assert.equal(result.passed, true); assert.equal(result.cases.length, 4); assert.equal(result.modelCalls, 0); passed = true;
  } finally { if (passed && !process.env.AI_DECK_QA_ROOT && path.dirname(fs.realpathSync(root)) === fs.realpathSync(os.tmpdir())) fs.rmSync(root, { recursive: true }); }
});
