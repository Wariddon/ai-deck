const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');

test('a large transcript formats nearby replies while keeping search, scrolling and code controls usable', {
  timeout: 70000, skip: process.platform !== 'win32',
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-large-history-')); let passed = false;
  try {
    await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/chat-isolation.cjs')], {
      windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_ROOT: root, AI_DECK_QA_APP: path.resolve(__dirname, '../desktop'), AI_DECK_QA_PHASE: 'first', AI_DECK_QA_PERFORMANCE: '1', AI_DECK_QA_HISTORY_TURNS: '1200' },
    });
    const result = JSON.parse(fs.readFileSync(path.join(root, 'first.json')));
    assert.equal(result.error, undefined, result.error); assert.equal(result.passed, true); assert.equal(result.calls.length, 0);
    assert.equal(result.performance.messages, 2400); assert.equal(result.performance.passes, 0);
    assert.ok(result.historyRendering.deferredCount > 1140); assert.equal(result.historyRendering.scrollAndWrapPreserved, true);
    passed = true;
  } finally { if (passed && path.dirname(fs.realpathSync(root)) === fs.realpathSync(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true }); }
});
