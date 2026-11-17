const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
test('ten bounded concurrent-work cycles measure retained heap, idle CPU and process cleanup with isolated drafts', { timeout: 60000, skip: process.platform !== 'win32' }, async () => {
  const root = process.env.AI_DECK_QA_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'deck-resource-cycles-')); let passed = false;
  try {
    await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/chat-isolation.cjs')], { windowsHide: true, timeout: 55000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_ROOT: root, AI_DECK_QA_APP: process.env.AI_DECK_QA_APP ?? path.resolve(__dirname, '../desktop'), AI_DECK_QA_PHASE: 'first',
        AI_DECK_QA_RESOURCE_CYCLES: '1', AI_DECK_QA_PERFORMANCE: '1', AI_DECK_QA_HISTORY_TURNS: '1200' } });
    const result = JSON.parse(fs.readFileSync(path.join(root, 'first.json'))); assert.equal(result.error, undefined, result.error + ' ' + root);
    assert.equal(result.passed, true); assert.equal(result.resources.cycles, 10); assert.equal(result.calls.length, 30); passed = true;
  } finally { if (passed && !process.env.AI_DECK_QA_ROOT && path.dirname(fs.realpathSync(root)) === fs.realpathSync(os.tmpdir())) fs.rmSync(root, { recursive: true }); }
});
