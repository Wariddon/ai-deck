const test = require('node:test'), assert = require('node:assert/strict');
const { attachMemberEngine, detachMemberEngine, memberEngine, stopMemberEngines } = require('../desktop/member-engines.cjs');

test('same-provider members route duplicate approval keys to their own engine and settle independently', async () => {
  const job = { run: { sessionTeam: {} } }, calls = [];
  const engine = name => ({ decide: key => (calls.push([name, key]), true), interrupt: async () => calls.push([name, 'stop']), close: () => calls.push([name, 'close']) });
  const a = engine('a'), b = engine('b');
  attachMemberEngine(job, 'left', 'codex', a); attachMemberEngine(job, 'right', 'codex', b);
  memberEngine(job, 'left', 'codex').decide('same-key');
  memberEngine(job, 'right', 'codex').decide('same-key');
  assert.deepEqual(calls, [['a', 'same-key'], ['b', 'same-key']]);
  detachMemberEngine(job, 'left', 'codex', a);
  assert.equal(memberEngine(job, 'left', 'codex'), undefined);
  assert.equal(memberEngine(job, 'right', 'codex'), b);
  await stopMemberEngines(job);
  assert.deepEqual(calls.at(-1), ['b', 'stop']);
  detachMemberEngine(job, 'right', 'codex', b);
  assert.equal(job.codex, null); assert.equal(job.memberEngines.size, 0);
});

test('Stop and close include every owned member once without touching a peer job', async () => {
  const calls = [], job = { run: { sessionTeam: {} } }, peer = { run: { sessionTeam: {} } };
  const create = name => ({ interrupt: async () => { calls.push(name); if (name === 'a') throw Error('closed pipe'); }, stop: async () => calls.push(name), close: () => calls.push(name + '-closed') });
  attachMemberEngine(job, 'a', 'codex', create('a')); attachMemberEngine(job, 'b', 'codex', create('b'));
  attachMemberEngine(job, 'c', 'claude', create('c')); attachMemberEngine(peer, 'peer', 'claude', create('peer'));
  await stopMemberEngines(job);
  assert.deepEqual(calls.sort(), ['a', 'a-closed', 'b', 'c']);
  calls.length = 0; await stopMemberEngines(job, true);
  assert.deepEqual(calls.sort(), ['a-closed', 'b-closed', 'c-closed']);
});
