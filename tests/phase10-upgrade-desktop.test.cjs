const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
test('the checked profile reopens on the previous and new program version without replay', { timeout: 65000, skip: !process.env.AI_DECK_QA_PREVIOUS_APP }, async () => {
  const root = process.env.AI_DECK_QA_ROOT, appDir = process.env.AI_DECK_QA_APP;
  assert.ok(root && appDir, 'Use the already checked isolated release profile.');
  for (const target of [process.env.AI_DECK_QA_PREVIOUS_APP, appDir]) {
    const version = JSON.parse(fs.readFileSync(path.join(target, 'package.json'))).version;
    await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/phase10-product.cjs')], { windowsHide: true, timeout: 28000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AI_DECK_QA_ROOT: root, AI_DECK_QA_APP: target, AI_DECK_QA_RESTORE: '1' } });
    const report = JSON.parse(fs.readFileSync(path.join(root, `restore-${version}.json`)));
    assert.equal(report.error, undefined, report.error); assert.equal(report.passed, true); assert.equal(report.modelCalls, 0);
  }
});
