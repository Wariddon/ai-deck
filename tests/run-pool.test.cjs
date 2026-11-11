const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { RunPool, locksOverlap, KeyedMutex } = require('../desktop/run-pool.cjs');

async function until(fn) {
  for (let i = 0; i < 30; i++) { if (fn()) return; await delay(30); }
  assert.ok(fn(), 'waiting job did not advance');
}
test('two isolated jobs overlap; a third waits; completion releases only its own slot', async (t) => {
  const pool = new RunPool(); t.after(() => pool.close());
  const scopes = new Map();
  const start = (key) => pool.submit({ key }, async () => { scopes.set(key, pool.scope); pool.adopt({ key }); });
  await start('a'); await start('b');
  assert.equal((await start('c')).waiting, true);
  assert.deepEqual([...scopes.keys()], ['a', 'b']);
  pool.release(scopes.get('a'));
  await until(() => scopes.has('c'));
  assert.equal(pool.get('b').key, 'b');
  assert.equal(pool.get('a'), undefined);
  pool.release(scopes.get('a')); // a stale completion cannot release c
  assert.equal(pool.size, 2);
});
test('async callbacks retain their task after another job starts', async (t) => {
  const pool = new RunPool(); t.after(() => pool.close());
  const observed = [];
  let done;
  const barrier = new Promise((resolve) => { done = resolve; });
  await pool.submit({ key: 'a', task: { id: 'a' } }, async () => {
    pool.adopt({ task: pool.scope.task });
    void (async () => { await barrier; observed.push(pool.scope.task.id); pool.release(); })();
  });
  await pool.submit({ key: 'b', task: { id: 'b' } }, async () => pool.adopt({ task: pool.scope.task }));
  done(); await until(() => observed.length);
  assert.deepEqual(observed, ['a']); assert.equal(pool.get('b').task.id, 'b');
});
test('same native session and nested writable folder wait, unrelated folders can overlap', async (t) => {
  const pool = new RunPool(); t.after(() => pool.close());
  await pool.submit({ key: 'a', locks: ['native:claude:1', 'folder:C:\\Repo'] }, async () => pool.adopt({}));
  assert.equal((await pool.submit({ key: 'b', locks: ['native:claude:1'] }, async () => pool.adopt({}))).waiting, true);
  assert.equal((await pool.submit({ key: 'c', locks: ['folder:c:/repo/sub'] }, async () => pool.adopt({}))).waiting, true);
  assert.ok(!((await pool.submit({ key: 'd', locks: ['folder:C:/Repo2'] }, async () => pool.adopt({})))?.waiting));
  assert.equal(locksOverlap('folder:C:/repo', 'folder:C:/repo2'), false);
});
test('Low RAM and headroom hold additional jobs without stopping existing work', async (t) => {
  let limit = 1, ram = Infinity;
  const pool = new RunPool({ limit: () => limit, headroom: () => ram }); t.after(() => pool.close());
  await pool.submit({ key: 'a' }, async () => pool.adopt({}));
  assert.equal((await pool.submit({ key: 'b' }, async () => pool.adopt({}))).waiting, true);
  limit = 2; ram = 100;
  await delay(300); assert.equal(pool.entries.get('b').state, 'waiting');
  ram = Infinity; await until(() => pool.entries.get('b').state === 'running');
  assert.equal(pool.size, 2);
});
test('duplicate submissions fail before a second call; cancelled queued native sends never start', async (t) => {
  const pool = new RunPool({ limit: () => 1 }); t.after(() => pool.close());
  await pool.submit({ key: 'a' }, async () => pool.adopt({}));
  assert.throws(() => pool.submit({ key: 'a' }, () => assert.fail('duplicate call')), /already has a job/);
  let rejected = false;
  await pool.submit({ key: 'b', job: { rejectWaiting: () => { rejected = true; } } }, () => assert.fail('cancelled call'));
  assert.equal(pool.cancel('b'), true); assert.equal(rejected, true);
  assert.ok(pool.get('a')); assert.equal(pool.size, 1);
});
test('preparation failure frees its reservation and waiting failures do not cancel peers', async (t) => {
  const errors = [];
  const pool = new RunPool({ limit: () => 1, failed: (_, error) => errors.push(error.message) }); t.after(() => pool.close());
  await assert.rejects(pool.submit({ key: 'bad' }, async () => { throw Error('preflight'); }), /preflight/);
  assert.equal(pool.size, 0);
  await pool.submit({ key: 'a' }, async () => pool.adopt({}));
  await pool.submit({ key: 'bad' }, async () => { throw Error('stale setup'); });
  pool.release(pool.entries.get('a'));
  await until(() => errors.length);
  assert.deepEqual(errors, ['stale setup']); assert.equal(pool.size, 0);
});

test('Stop during asynchronous preparation prevents adoption and a model dispatch', async (t) => {
  const pool = new RunPool(); t.after(() => pool.close());
  let finish;
  const barrier = new Promise((resolve) => { finish = resolve; });
  const started = pool.submit({ key: 'preparing' }, async () => { await barrier; pool.adopt({ run: { id: 'never-dispatched' } }); });
  assert.equal(pool.cancel('preparing'), true);
  finish();
  await assert.rejects(started, /no longer scheduled/);
  assert.equal(pool.size, 0);
});

test('Git preparation serializes a shared common directory while unrelated repositories progress', async () => {
  const mutex = new KeyedMutex();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  const first = mutex.run('repo', async () => { order.push('first'); await gate; });
  const second = mutex.run('repo', async () => order.push('second'));
  await mutex.run('other', async () => order.push('other'));
  assert.deepEqual(order, ['first', 'other']);
  release(); await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'other', 'second']); assert.equal(mutex.tails.size, 0);
});
