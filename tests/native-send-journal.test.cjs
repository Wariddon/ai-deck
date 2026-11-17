const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { randomUUID } = require('node:crypto');
const { NativeSendJournal } = require('../desktop/native-send-journal.cjs');
const entry = { provider: 'codex', id: 'same-id' };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-send-journal-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  return { root, journal: new NativeSendJournal(root) };
}
function dispatch(journal, cwd, options = {}) {
  const value = { requestId: randomUUID(), draftToken: randomUUID(), prompt: 'Do it', images: [], ...options };
  journal.begin(entry, cwd, value);
  journal.update(entry, cwd, value.requestId, { status: 'dispatched', previousIds: ['old'] });
  return value;
}
test('native send fence survives restart, distinguishes receipt from reply and rejects replayed IDs or drafts', t => {
  const { root, journal } = fixture(t), sent = dispatch(journal, root), restored = new NativeSendJournal(root);
  assert.throws(() => restored.begin(entry, root, sent), /previously submitted/);
  assert.throws(() => restored.begin(entry, root, { ...sent, requestId: randomUUID(), draftToken: randomUUID() }), /unconfirmed/);
  const messages = [{ id: 'new', role: 'user', text: sent.prompt }, { id: 'old', role: 'user', text: sent.prompt }];
  assert.equal(restored.reconcile(entry, root, { messages }).status, 'saved');
  assert.equal(restored.reconcile(entry, root, { messages: [{ id: 'reply', role: 'assistant', text: 'Done' }, ...messages] }).status, 'replied');
  assert.throws(() => restored.begin(entry, root, { ...sent, requestId: randomUUID() }), /previously submitted/);
  restored.begin(entry, root, { ...sent, requestId: randomUUID(), draftToken: randomUUID() }); // Intentional new draft.
});
test('absent, active, skipped or older-only transcripts never turn an uncertain send into unsent', t => {
  const { root, journal } = fixture(t); dispatch(journal, root);
  for (const page of [{ messages: [], active: false }, { messages: [], skipped: true }, { messages: [], active: true },
    { messages: [{ id: 'old', role: 'user', text: 'Do it' }] }]) assert.equal(journal.reconcile(entry, root, page).status, 'dispatched');
});
test('checkpoint keeps partial text, settings and attachment references without reviving controls', t => {
  const { root, journal } = fixture(t), sent = dispatch(journal, root, { permissionMode: 'ask', settings: { model: 'fixture' }, images: [{ id: 'image' }] });
  journal.update(entry, root, sent.requestId, { phase: 'waiting-approval', partialText: 'Working on the file.' });
  const record = new NativeSendJournal(root).read(entry, root).records[0];
  assert.equal(record.phase, 'waiting-approval'); assert.equal(record.partialText, 'Working on the file.');
  assert.equal(record.settings.model, 'fixture'); assert.equal(record.images[0].id, 'image'); assert.equal(record.controls, undefined);
});
test('folder mismatch and corrupted checkpoint fail closed while providers with the same ID stay separate', t => {
  const { root, journal } = fixture(t); dispatch(journal, root);
  assert.equal(journal.read({ ...entry, provider: 'claude' }, root).records.length, 0);
  assert.throws(() => journal.read(entry, path.join(root, 'another')), /folder changed/);
  fs.writeFileSync(journal.filename(entry), '{broken'); assert.throws(() => journal.read(entry, root), /could not be read/);
});
test('failed atomic checkpoint replacement preserves the prior dispatch fence', t => {
  const { root, journal } = fixture(t), sent = dispatch(journal, root), before = fs.readFileSync(journal.filename(entry));
  fs.mkdirSync(journal.filename(entry) + '.tmp');
  assert.throws(() => journal.update(entry, root, sent.requestId, { status: 'replied' }));
  assert.deepEqual(fs.readFileSync(journal.filename(entry)), before);
  assert.equal(journal.read(entry, root).records[0].status, 'dispatched');
});
test('settled history stays bounded without evicting uncertain messages', t => {
  const { root, journal } = fixture(t), pending = dispatch(journal, root);
  for (let n = 0; n < 50; n++) {
    const value = { requestId: randomUUID(), prompt: 'Next ' + n };
    journal.begin(entry, root, value); journal.update(entry, root, value.requestId, { status: 'not-sent' });
  }
  const rows = journal.read(entry, root).records;
  assert.ok(rows.length <= 33); assert.ok(rows.some(record => record.requestId === pending.requestId));
});
