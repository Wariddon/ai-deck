const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), { randomUUID } = require('node:crypto');
const { listClaudeSessions } = require('../desktop/native-recents.cjs');

test('large Recents scans read only recent bounded headers and reuse unchanged metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-recents-performance-')), ids = [], now = Date.now();
  const originalOpen = fsp.open; let opens = 0, bytes = 0;
  try {
    for (let i = 0; i < 1200; i++) {
      const id = randomUUID(), folder = path.join(root, 'project-' + i % 8); ids.push(id); fs.mkdirSync(folder, { recursive: true });
      const file = path.join(folder, id + '.jsonl');
      const message = JSON.stringify({ sessionId: id, type: 'user', cwd: root, message: { content: 'Recent case ' + i } });
      const largeTool = i < 10 ? '\n' + JSON.stringify({ sessionId: id, type: 'tool', text: 'x'.repeat(1024 * 1024) }) : '';
      fs.writeFileSync(file, message + largeTool + '\n' + JSON.stringify({ sessionId: id, customTitle: 'Recent case ' + i }) + '\n');
      const at = new Date(now - i * 1000); fs.utimesSync(file, at, at);
    }
    fsp.open = async function (...args) {
      const handle = await originalOpen.apply(this, args); opens++;
      const read = handle.read.bind(handle); handle.read = async (...args) => { const result = await read(...args); bytes += result.bytesRead; return result; };
      return handle;
    };
    const coldStart = performance.now(), first = await listClaudeSessions(root), cold = { ms: performance.now() - coldStart, opens, bytes };
    assert.deepEqual(first.map(row => row.id), ids.slice(0, 40)); assert.equal(first[0].title, 'Recent case 0');
    assert.equal(opens, 40); assert.ok(bytes <= 40 * 384 * 1024);
    opens = 0; bytes = 0;
    const warmStart = performance.now(), second = await listClaudeSessions(root), warm = { ms: performance.now() - warmStart, opens, bytes };
    assert.deepEqual(second, first); assert.equal(opens, 0); assert.equal(bytes, 0);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(listClaudeSessions(root, { signal: controller.signal }), { name: 'AbortError' }); assert.equal(opens, 0);
    if (process.env.AI_DECK_QA_PERF_REPORT) fs.writeFileSync(process.env.AI_DECK_QA_PERF_REPORT, JSON.stringify({ sessionsOnDisk: 1200, displayed: first.length, cold, warm }, null, 2));
  } finally { fsp.open = originalOpen; if (path.dirname(fs.realpathSync(root)) === fs.realpathSync(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true }); }
});
