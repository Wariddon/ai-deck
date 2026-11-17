import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectTests } from '../scripts/ci-tests.mjs';

test('CI suites cover every current test exactly once, including new files, without overlapping shards', () => {
  const files = fs.readdirSync(new URL('.', import.meta.url)).map(file => 'tests/' + file);
  const all = selectTests(files), suites = ['unit', 'desktop-1', 'desktop-2', 'desktop-3'].map(suite => selectTests(files, suite));
  assert.ok(all.length > 100); assert.ok(suites.every(files => files.length));
  const selected = suites.flat(); assert.equal(new Set(selected).size, selected.length); assert.deepEqual(selected.sort(), all);
  for (const file of ['tests/future.test.mjs', 'tests/future-desktop.test.cjs']) {
    assert.equal(['unit', 'desktop-1', 'desktop-2', 'desktop-3'].filter(suite => selectTests([file], suite).length).length, 1);
  }
  assert.throws(() => selectTests(files, 'wrong'), /Unknown CI/);
});
