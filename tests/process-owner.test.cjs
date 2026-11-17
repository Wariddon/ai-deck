const { test, mock, after } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const processes = require('node:child_process'), { setTimeout: delay } = require('node:timers/promises');
const appDir = process.env.AI_DECK_QA_APP ?? path.resolve(__dirname, '../desktop');
const engineFile = path.join(appDir, 'engines.cjs');
const { spawnOwned, stopChild } = require(path.join(appDir, 'process-owner.cjs'));
const { RunPool } = require(path.join(appDir, 'run-pool.cjs'));
// Packaged engines normally receive Electron's built-in module. These Node
// process/protocol checks never use images; desktop tests exercise the real API.
if (process.env.AI_DECK_QA_APP && !process.versions.electron) {
  const modules = require('node:module'), load = modules._load;
  const replacement = mock.method(modules, '_load', function(id, ...args) {
    return id === 'electron' ? { nativeImage: {} } : load.call(this, id, ...args);
  });
  after(() => replacement.mock.restore());
}
const fixture = path.join(__dirname, 'fixtures/owned-cli.cjs');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await delay(25); } assert.ok(fn(), 'Process condition did not settle'); }
function setup(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-owned-process-')), children = [];
  const start = (mode, name) => { const child = spawnOwned(process.execPath, [fixture, mode, folder, name], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); children.push(child); return child; };
  const ready = async name => { await until(() => fs.existsSync(path.join(folder, name + '-leaf.json'))); return JSON.parse(fs.readFileSync(path.join(folder, name + '.json'))); };
  t.after(async () => { await Promise.all(children.map(stopChild)); if (path.dirname(fs.realpathSync(folder)) === fs.realpathSync(os.tmpdir())) fs.rmSync(folder, { recursive: true, force: true }); });
  return { folder, children, start, ready };
}

test('two real process trees overlap, Stop cleans only its tree, and the third waits for release', { timeout: 12000 }, async t => {
  const q = setup(t), pool = new RunPool(); t.after(() => pool.close()); const started = [];
  const submit = key => pool.submit({ key }, async () => { started.push(key); pool.adopt({ child: q.start('worker', key) }); });
  await submit('a'); await submit('b'); const a = await q.ready('a'), b = await q.ready('b');
  await submit('c'); assert.deepEqual(started, ['a', 'b']);
  await stopChild(pool.get('a').child); await until(() => !alive(a.pid) && !alive(a.leaf));
  assert.ok(alive(b.pid) && alive(b.leaf)); assert.equal(started.length, 2);
  pool.release(pool.entries.get('a')); await until(() => started.includes('c')); const c = await q.ready('c');
  assert.ok(alive(c.pid) && alive(c.leaf)); assert.ok(alive(b.pid));
});

test('real Codex lifecycle cleanup removes descendants after success and initialization failure', { timeout: 15000 }, async t => {
  const q = setup(t), spawn = processes.spawn;
  const replacement = mock.method(processes, 'spawn', (exe, args, options) => {
    if (!String(exe).startsWith('qa-codex')) return spawn(exe, args, options);
    const mode = exe.slice(3);
    const child = spawn(process.execPath, [fixture, mode, q.folder, mode], options); q.children.push(child); return child;
  }); t.after(() => replacement.mock.restore());
  delete require.cache[require.resolve(engineFile)]; const { CodexEngine } = require(engineFile);
  const peer = q.start('worker', 'peer'); const p = await q.ready('peer');
  for (const mode of ['codex', 'codex-error', 'codex-exit']) {
    const engine = new CodexEngine('qa-' + mode, q.folder, [], () => {});
    try { const r = await q.ready(mode); if (mode !== 'codex') await assert.rejects(engine.initialize());
      else { await engine.initialize(); assert.equal((await engine.run('thread', q.folder, 'Fixture', false)).status, 'completed'); }
      await engine.shutdown(); await until(() => !alive(r.pid) && !alive(r.leaf)); assert.ok(alive(p.pid) && alive(p.leaf));
    } finally { await engine.shutdown(); }
  }
  await stopChild(peer);
});

test('real Claude success, failure and targeted Stop settle and leave no owned descendant', { timeout: 18000 }, async t => {
  const q = setup(t), spawn = processes.spawn;
  const replacement = mock.method(processes, 'spawn', (exe, args, options) => {
    if (!String(exe).startsWith('qa-claude')) return spawn(exe, args, options);
    const mode = exe.slice(3), child = spawn(process.execPath, [fixture, mode, q.folder, mode], options); q.children.push(child); return child;
  }); t.after(() => replacement.mock.restore());
  delete require.cache[require.resolve(engineFile)]; const { runClaude } = require(engineFile);
  q.start('worker', 'peer'); const p = await q.ready('peer');
  for (const [mode, status] of [['claude', 'completed'], ['claude-error', 'failed'], ['claude-stop', 'interrupted'], ['claude-exit', 'completed']]) {
    const runner = runClaude('qa-' + mode, q.folder, 'Fixture', [], null, () => {}, { role: 'review' });
    const r = await q.ready(mode); if (mode === 'claude-stop') await runner.stop();
    assert.equal((await runner.done).status, status); await until(() => !alive(r.pid) && !alive(r.leaf));
    assert.ok(alive(p.pid) && alive(p.leaf));
  }
});

test('aborted metadata capture terminates its process tree without touching a peer', { timeout: 10000 }, async t => {
  const q = setup(t), { capture } = require(engineFile); q.start('worker', 'peer'); const peer = await q.ready('peer');
  const controller = new AbortController(), pending = capture(process.execPath, [fixture, 'worker', q.folder, 'metadata'], { signal: controller.signal });
  const r = await q.ready('metadata'); controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  await until(() => !alive(r.pid) && !alive(r.leaf)); assert.ok(alive(peer.pid) && alive(peer.leaf));
});
