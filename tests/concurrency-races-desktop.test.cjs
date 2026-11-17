const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
test('late model saves and parallel native chats preserve completion, selected controls and drafts across restart', { timeout: 85000, skip: process.platform !== 'win32' }, async () => {
  const root = process.env.AI_DECK_QA_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'deck-concurrency-races-')); let passed = false;
  try {
    for (const phase of ['first', 'restore']) {
      await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/chat-isolation.cjs')], { windowsHide: true, timeout: 40000, maxBuffer: 1024 * 1024,
        env: { ...process.env, AI_DECK_QA_ROOT: root, AI_DECK_QA_APP: process.env.AI_DECK_QA_APP ?? path.resolve(__dirname, '../desktop'), AI_DECK_QA_PHASE: phase,
          AI_DECK_QA_PHASE2: '1', AI_DECK_QA_CONCURRENCY_RACES: '1', AI_DECK_QA_PERFORMANCE: '1', AI_DECK_QA_HISTORY_TURNS: '1200' } });
      const result = JSON.parse(fs.readFileSync(path.join(root, phase + '.json'))); assert.equal(result.error, undefined, result.error + ' ' + root);
      assert.equal(result.passed, true); assert.equal(result.calls.length, phase === 'first' ? 4 : 0);
      if (phase === 'first') { assert.equal(result.liveTyping.events, 480); assert.equal(result.liveTyping.samplesMs.length, 6); }
    } passed = true;
  } finally { if (passed && !process.env.AI_DECK_QA_ROOT && path.dirname(fs.realpathSync(root)) === fs.realpathSync(os.tmpdir())) fs.rmSync(root, { recursive: true }); }
});
