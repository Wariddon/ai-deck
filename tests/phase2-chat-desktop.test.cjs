const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');

test('Phase 2 navigation preserves the selected chat, frozen settings and controls through late results and restart', {
  timeout: 150000, skip: process.platform !== 'win32',
}, async () => {
  const root = process.env.AI_DECK_QA_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'deck-phase2-')); let passed = false;
  try {
    for (const phase of ['first', 'restore']) {
      await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/chat-isolation.cjs')], {
        windowsHide: true, timeout: 70000, maxBuffer: 1024 * 1024,
        env: { ...process.env, AI_DECK_QA_ROOT: root, AI_DECK_QA_APP: process.env.AI_DECK_QA_APP ?? path.resolve(__dirname, '../desktop'), AI_DECK_QA_PHASE: phase, AI_DECK_QA_PHASE2: '1' },
      });
      const result = JSON.parse(fs.readFileSync(path.join(root, phase + '.json')));
      assert.equal(result.error, undefined, result.error); assert.equal(result.passed, true);
      assert.equal(result.calls.length, phase === 'restore' ? 0 : 12);
      if (phase === 'first') { assert.equal(result.checks.length, 7); assert.equal(result.exactNativeIds, true); }
    }
    passed = true;
  } finally {
    if (passed && !process.env.AI_DECK_QA_ROOT && path.dirname(fs.realpathSync(root)) === fs.realpathSync(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true });
  }
});
