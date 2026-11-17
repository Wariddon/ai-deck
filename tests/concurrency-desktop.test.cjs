const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
test('Phase 4 desktop jobs isolate active peers, the third waiter, duplicate submit, Low RAM and Stop', { timeout: 35000, skip: process.platform !== 'win32' }, async () => {
  const root = process.env.AI_DECK_QA_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'deck-concurrency-')); let passed = false;
  try {
    await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/chat-isolation.cjs')], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_ROOT: root, AI_DECK_QA_APP: process.env.AI_DECK_QA_APP ?? path.resolve(__dirname, '../desktop'), AI_DECK_QA_PHASE: 'first', AI_DECK_QA_CONCURRENCY: '1' } });
    const r = JSON.parse(fs.readFileSync(path.join(root, 'first.json')));
    assert.equal(r.error, undefined, r.error); assert.equal(r.passed, true); assert.equal(r.calls.length, 4); assert.equal(r.checks.length, 2); passed = true;
  } finally { if (passed && !process.env.AI_DECK_QA_ROOT && path.dirname(fs.realpathSync(root)) === fs.realpathSync(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true }); }
});
