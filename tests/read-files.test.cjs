const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { test } = require('node:test');
const { readTaskFile, searchTaskFiles } = require('../desktop/read-files.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-file-read-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'app.ts'), 'const greeting = "สวัสดี";\nexport function applyLayout() {}\n');
  await fs.writeFile(path.join(root, '.env'), 'applyLayout=PRIVATE');
  return root;
}
test('reviewer reads real numbered source and bounded literal matches without Git', async t => {
  const root = await fixture(t);
  const data = JSON.parse((await readTaskFile(root, { file: 'app.ts', line: 2, lines: 1 })).text);
  assert.deepEqual(data.lines, [{ line: 2, text: 'export function applyLayout() {}' }]);
  const found = JSON.parse((await searchTaskFiles(root, { query: 'APPLYLAYOUT' })).text);
  assert.deepEqual(found.matches.map(({ file, line }) => [file, line]), [['app.ts', 2]]);
  assert.equal(await fs.readFile(path.join(root, 'app.ts'), 'utf8'), 'const greeting = "สวัสดี";\nexport function applyLayout() {}\n');
});
test('reviewer rejects external, sensitive, linked and binary files and honors cancellation', async t => {
  const root = await fixture(t);
  for (const file of ['../app.ts', '.env', 'C:/Windows/win.ini', 'app.ts:stream'])
    await assert.rejects(readTaskFile(root, { file }), /relative file/);
  await fs.writeFile(path.join(root, 'binary'), Buffer.from([1, 0, 3]));
  await assert.rejects(readTaskFile(root, { file: 'binary' }), /binary/);
  await fs.link(path.join(root, 'app.ts'), path.join(root, 'linked.ts'));
  await assert.rejects(readTaskFile(root, { file: 'linked.ts' }), /large or binary/);
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'node_modules', 'generated.ts'), 'applyLayout');
  assert.equal(JSON.parse((await searchTaskFiles(root, { query: 'applyLayout' })).text).matches.length, 0);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(readTaskFile(root, { file: 'app.ts' }, abort.signal), /abort/i);
  await assert.rejects(searchTaskFiles(root, { query: 'applyLayout' }, abort.signal), /abort/i);
});
test('large file reads remain valid structured evidence within the token budget', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'long.ts'), ('x'.repeat(1900) + '\n').repeat(200));
  const result = await readTaskFile(root, { file: 'long.ts', lines: 200 });
  assert.ok(result.text.length < 13000);
  assert.equal(JSON.parse(result.text).truncated, true);
});

test('binary files consume the search I/O budget even though their contents are omitted', async t => {
  const root = await fixture(t);
  await fs.rm(path.join(root, 'app.ts'));
  const binary = Buffer.alloc(512 * 1024);
  for (let index = 0; index < 24; index++) await fs.writeFile(path.join(root, 'block-' + String(index).padStart(2, '0')), binary);
  await fs.mkdir(path.join(root, 'source'));
  await fs.writeFile(path.join(root, 'source', 'later.ts'), 'needle-after-binary-budget');
  const result = JSON.parse((await searchTaskFiles(root, { query: 'needle-after-binary-budget' })).text);
  assert.equal(result.matches.length, 0);
  assert.ok(result.bytesRead <= 12 * 1024 * 1024);
  assert.equal(result.truncated, true);
});
