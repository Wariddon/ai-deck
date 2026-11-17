const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
test('concurrent member counters, controls, drafts and native IDs survive noisy checks and restart', { timeout: 90000, skip: process.platform !== 'win32' }, async () => {
  const root = process.env.AI_DECK_QA_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'deck-member-isolation-')); let passed = false;
  const env = { ...process.env, AI_DECK_QA_ROOT: root, AI_DECK_QA_APP: process.env.AI_DECK_QA_APP ?? path.resolve(__dirname, '../desktop') };
  try {
    await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/member-isolation.cjs')], { windowsHide: true, timeout: 70000, maxBuffer: 1024 * 1024, env });
    const result = JSON.parse(fs.readFileSync(path.join(root, 'result.json')));
    assert.equal(result.error, undefined, result.error + ' ' + root); assert.equal(result.passed, true); assert.equal(result.calls.length, 8); assert.equal(result.checks.length, 5);
    await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/member-learning-restart.cjs')], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, env });
    const restarted = JSON.parse(fs.readFileSync(path.join(root, 'restart.json'))); assert.equal(restarted.error, undefined, restarted.error); assert.equal(restarted.passed, true); assert.equal(restarted.calls, 0); passed = true;
  } finally { if (passed && !process.env.AI_DECK_QA_ROOT && path.dirname(fs.realpathSync(root)) === fs.realpathSync(os.tmpdir())) fs.rmSync(root, { recursive: true }); }
});
