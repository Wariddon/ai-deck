const { test } = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const app = process.env.AI_DECK_QA_APP || path.resolve(__dirname, '../desktop');
const { memberIdentity, snapshotMemberLearning, memberGuide, memberCheckReports, memberObservations, updateMemberLearning, recordMemberGuides } = require(path.join(app, 'member-learning.cjs'));
const repo = process.cwd(), identity = options => memberIdentity({ repo, provider: 'codex', role: 'write', settings: { model: 'gpt-test', effort: 'high', speed: 'standard' }, ...options });
function sample(options = {}) {
  const member = identity(), run = { id: 'run-1', agents: { codex: { status: 'completed', providerCalls: 1 } } };
  const report = { agent: 'codex', memberProfileKey: member.key, kind: 'command', freshness: 'matched', subject: 'node --test', exitCode: 0, ...options };
  return { member, run, report, identities: { [member.key]: member } };
}

test('member identities isolate project, task/member, provider, role and every model setting', () => {
  const base = identity();
  for (const changes of [{ repo: path.join(repo, 'other') }, { provider: 'claude' }, { role: 'review' }, { version: 'new-cli' },
    { settings: { model: 'gpt-other', effort: 'high', speed: 'standard' } }, { settings: { model: 'gpt-test', effort: 'low', speed: 'standard' } },
    { settings: { model: 'gpt-test', effort: 'high', speed: 'fast' } }, { taskId: 'task1', memberId: 'member1' }]) assert.notEqual(identity(changes).key, base.key);
  assert.notEqual(identity({ taskId: 'a', memberId: 'same' }).key, identity({ taskId: 'b', memberId: 'same' }).key);
  assert.equal(identity({ settings: {} }), null); assert.equal(identity({ settings: { model: 1 } }), null);
  assert.equal(identity({ provider: 'gemini' }), null);
});

test('reordering the same saved controls keeps the existing member bucket', () => {
  const before = identity(), after = identity({ settings: { speed: 'standard', model: 'gpt-test', effort: 'high' } });
  assert.equal(after.key, before.key);
  const { run, report, identities } = sample();
  const book = updateMemberLearning(snapshotMemberLearning(repo), memberObservations(run, [report], identities));
  assert.equal(memberGuide(book, after).memberGuide.stats[0].samples, 1);
});

test('test paths mentioning build or compile remain test outcomes', () => {
  const { run, report, identities } = sample();
  for (const subject of ['node --test tests/build.test.cjs', 'pytest tests/test_compile.py', 'npm test -- --grep build']) {
    assert.equal(memberObservations(run, [{ ...report, subject }], identities)[0].skill, 'tests', subject);
  }
});

test('only completed dispatched members and current owned command evidence provide samples', () => {
  const { run, report, identities } = sample();
  assert.equal(memberObservations(run, [report], identities)[0].passed, true);
  for (const changes of [{ freshness: 'changed' }, { freshness: 'unknown' }, { kind: 'approval' }, { agent: 'other' }, { hook: true }, { memberProfileKey: 'foreign' }]) {
    assert.equal(memberObservations(run, [{ ...report, ...changes }], identities).length, 0);
  }
  for (const changes of [{ subject: 'node --test &' }, { subject: 'node --test; echo done' }, { subject: 'Start-Process node --test' },
    { exitCode: 124 }, { exitCode: 130 }, { status: 'interrupted' }, { status: 'timed out' }]) {
    assert.equal(memberObservations(run, [{ ...report, ...changes }], identities).length, 0);
  }
  for (const status of ['failed', 'limited', 'interrupted', 'skipped', 'queued']) {
    assert.equal(memberObservations({ ...run, agents: { codex: { status, providerCalls: 1 } } }, [report], identities).length, 0);
  }
  assert.equal(memberObservations({ ...run, agents: { codex: { status: 'completed', providerCalls: 0 } } }, [report], identities).length, 0);
  assert.equal(memberObservations({ ...run, agents: { codex: { status: 'completed', providerCalls: 1, reportedModel: 'rerouted-other' } } }, [report], identities).length, 0);
  assert.equal(memberObservations(run, [{ ...report, exitCode: undefined }], identities).length, 0);
  assert.equal(memberObservations(run, [{ ...report, exitCode: undefined, completionSource: 'claude-tool-result', completion: 'succeeded' }], identities)[0].passed, true);
});

test('one run yields one sample per skill; an observed failure cannot be outvoted by repeated passes', () => {
  const { run, report, identities } = sample();
  const observations = memberObservations(run, [report, { ...report, exitCode: 1 }, ...Array(20).fill(report), { ...report, subject: 'npm run build' }], identities);
  assert.equal(observations.length, 2); assert.equal(observations.find(row => row.skill === 'tests').passed, false);
  let book = updateMemberLearning(snapshotMemberLearning(repo), observations);
  book = updateMemberLearning(book, observations);
  assert.deepEqual(book.rows[0].skills.tests, { passed: 0, failed: 1 }); assert.deepEqual(book.rows[0].skills.build, { passed: 1, failed: 0 });
  assert.equal(JSON.stringify(book).includes('node --test'), false);
});

test('activity truncation cannot discard a matched failure from member scoring', () => {
  const { run, report, identities } = sample(), checkout = { cwd: repo, branch: 'main', head: 'head', stamp: 'current' };
  const checks = [{ ...report, id: 'failed', exitCode: 1, checkout }, { ...report, id: 'passed', checkout }];
  const noise = Array.from({ length: 65 }, (_, i) => ({ ...report, id: String(i), subject: 'git status --short' }));
  run.evidence = [...checks, ...noise].slice(-60);
  const reports = memberCheckReports(run, checkout, checks);
  const observations = memberObservations(run, reports, identities);
  assert.equal(observations.length, 1); assert.equal(observations[0].passed, false);
  assert.equal(memberObservations(run, memberCheckReports(run, { ...checkout, stamp: 'changed' }, checks), identities).length, 0);
});

test('coaching uses bounded measured counts without sharing reports or trusting reviewer prose', () => {
  const { run, report, identities, member } = sample(); let book = snapshotMemberLearning(repo);
  assert.match(memberGuide(book, member).text, /Insufficient/);
  for (let n = 0; n < 3; n++) book = updateMemberLearning(book, memberObservations({ ...run, id: String(n) }, [{ ...report, exitCode: n ? 0 : 1 }], identities));
  const guide = memberGuide(book, member);
  assert.equal(guide.memberGuide.stats[0].samples, 3); assert.equal(guide.memberGuide.stats[0].passPercent, 67);
  assert.match(guide.text, /2\/3 passed/); assert.match(guide.text, /not general model quality/); assert.match(guide.text, /Earlier observed checks included failures/);
  assert.ok(guide.text.length < 1500); assert.equal(memberGuide(snapshotMemberLearning(path.join(repo, 'foreign'), book), member), null);
  const serialized = snapshotMemberLearning(repo, JSON.parse(JSON.stringify(book)));
  assert.deepEqual(serialized, book);
});

test('snapshots stay frozen, corrupted/foreign rows are withheld and applied guide receipts are deduplicated', () => {
  const { run, report, identities, member } = sample(), before = snapshotMemberLearning(repo);
  const after = updateMemberLearning(before, memberObservations(run, [report], identities));
  assert.equal(before.rows.length, 0); assert.equal(after.rows.length, 1);
  assert.equal(snapshotMemberLearning(path.join(repo, 'other'), after).rows.length, 0);
  const corrupted = JSON.parse(JSON.stringify(after)); corrupted.rows[0].identity.model = 'different';
  assert.equal(snapshotMemberLearning(repo, corrupted).rows.length, 0);
  const guide = memberGuide(after, member);
  recordMemberGuides(run, 'codex', 'write', [guide]); recordMemberGuides(run, 'codex', 'write', [guide]);
  assert.equal(run.memberLearning.applied.length, 1);
  assert.equal(JSON.stringify(run.memberLearning).includes('Member-specific verification guide'), false);
});
