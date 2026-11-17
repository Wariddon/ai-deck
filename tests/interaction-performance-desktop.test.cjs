const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
test('large chats and twenty image drafts keep model menus, typing and thumbnail reads scoped and bounded', { timeout: 80000, skip: process.platform !== 'win32' }, async () => {
  const root = process.env.AI_DECK_QA_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'deck-interaction-performance-')); let passed = false;
  try {
    await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/chat-isolation.cjs')], { windowsHide: true, timeout: 70000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_APP: process.env.AI_DECK_QA_APP ?? path.resolve(__dirname, '../desktop'), AI_DECK_QA_ROOT: root, AI_DECK_QA_PHASE: 'first', AI_DECK_QA_PERFORMANCE: '1', AI_DECK_QA_HISTORY_TURNS: '1200', AI_DECK_QA_INTERACTION_MATRIX: '1' } });
    const r = JSON.parse(fs.readFileSync(path.join(root, 'first.json'))); assert.equal(r.error, undefined, r.error); assert.equal(r.passed, true); assert.equal(r.calls.length, 0);
    assert.equal(r.interactions.images, 20); assert.ok(r.interactions.nearbyReads < 10); assert.equal(r.interactions.draftAndSettingsPreserved, true); passed = true;
  } finally { if (passed && !process.env.AI_DECK_QA_ROOT && path.dirname(fs.realpathSync(root)) === fs.realpathSync(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true }); }
});
