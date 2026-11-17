const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');

test('startup measures readiness stages and releases the UI when auth, history or account metadata ignores cancellation', {
  timeout: 135000, skip: process.platform !== 'win32',
}, async () => {
  const root = process.env.AI_DECK_QA_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'deck-startup-performance-')); let passed = false;
  try {
    for (const scenario of ['healthy', 'low-memory', 'auth-stalled', 'history-stalled', 'account-stalled']) {
      const output = path.join(root, scenario);
      await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/startup-performance.cjs')], {
        windowsHide: true, timeout: 28000, maxBuffer: 1024 * 1024,
        env: { ...process.env, AI_DECK_QA_ROOT: output, AI_DECK_QA_APP: process.env.AI_DECK_QA_APP ?? path.resolve(__dirname, '../desktop'), AI_DECK_QA_STARTUP_CASE: scenario },
      });
      const result = JSON.parse(fs.readFileSync(path.join(output, 'result.json')));
      assert.equal(result.error, undefined, result.error); assert.equal(result.passed, true); assert.equal(result.modelCalls, 0);
      assert.ok(result.readyMs < 17000); assert.ok(Number.isFinite(result.startup.timings.totalMs));
      assert.equal(result.startup.timings.quota.length, scenario === 'history-stalled' ? 0 : 2);
      if (scenario === 'account-stalled') assert.ok(result.startup.timings.quota.some(row => row.agent === 'claude' && row.reported), 'The healthy account snapshot must finish while the other provider is stalled');
      if (['healthy', 'low-memory'].includes(scenario)) {
        const [a, b] = result.quotaIntervals;
        assert.equal(a.end > b.start, scenario === 'healthy', 'Normal startup overlaps metadata reads; Low RAM remains serial');
      }
    }
    passed = true;
  } finally { if (passed && !process.env.AI_DECK_QA_ROOT && path.dirname(fs.realpathSync(root)) === fs.realpathSync(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true }); }
});
