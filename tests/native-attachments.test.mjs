import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeAttachmentInput, nativeAttachmentPrefix, nativeMessageAttachments } from '../desktop/native-attachments.mjs';
import { nativeChatDelivery } from '../desktop/native-chat-delivery.mjs';
import { loadNativeFiles, saveNativeFiles, updateNativeFiles, subscribeNativeFiles } from '../src/native-files-draft.mjs';
test('native attachment receipt recognizes quoted document bodies without exposing them as chat text', () => {
  const prompt = 'Read these', requestId = 'request-1', images = [{ id: 'image.png', name: 'Diagram' }];
  const wire = nativeAttachmentInput(prompt, requestId, images);
  const messages = [{ id: 'reply', role: 'assistant', text: 'Received' }, { id: 'new', role: 'user', text: wire + '\nLong quoted document data' }];
  assert.equal(nativeChatDelivery({ prompt: wire, wirePrefix: nativeAttachmentPrefix(requestId), previousIds: new Set() }, messages), 'replied');
  const records = [{ sessionKey: 'codex:one', requestId, prompt, images }];
  assert.deepEqual(nativeMessageAttachments(messages, records, 'codex:one')[1], { id: 'new', role: 'user', text: prompt, images, attachmentRequestId: requestId });
  assert.equal(nativeMessageAttachments(messages, records, 'claude:one')[1].text, messages[1].text);
  assert.equal(nativeAttachmentInput(prompt, requestId, []), prompt);
});
test('native file drafts keep per-chat attachments and pending version across restart', () => {
  let raw; const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  const saved = { images: [{ id: 'file.txt', name: 'Report', kind: 'text' }], version: 4, pending: { version: 3, requestId: 'old' } };
  saveNativeFiles(storage, 'codex:one', saved);
  assert.deepEqual(loadNativeFiles(storage, 'codex:one'), saved);
  assert.deepEqual(loadNativeFiles(storage, 'claude:one').images, []);
  saveNativeFiles(storage, 'claude:one', saved);
  saveNativeFiles(storage, 'codex:one', { images: [], version: 5 });
  assert.deepEqual(loadNativeFiles(storage, 'claude:one'), saved);
});

test('a detached file import merges into the latest draft and does not reuse cleared versions', () => {
  let raw; const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  saveNativeFiles(storage, 'codex:one', { images: [], version: 8 });
  const events = [], unsubscribe = subscribeNativeFiles('codex:one', (record, change) => events.push({ record, change }));
  updateNativeFiles(storage, 'codex:one', current => ({ images: [{ id: 'new.txt', name: 'new' }], version: current.version + 1 }), 'new editor');
  updateNativeFiles(storage, 'codex:one', current => ({ images: [...current.images, { id: 'late.txt', name: 'late' }], version: current.version + 1 }), 'detached import');
  assert.deepEqual(loadNativeFiles(storage, 'codex:one').images.map(row => row.id), ['new.txt', 'late.txt']);
  assert.equal(events[1].record.version, 10);
  unsubscribe(); saveNativeFiles(storage, 'codex:one', { images: [], version: 11 });
  assert.equal(events.length, 2);
  assert.equal(loadNativeFiles(storage, 'codex:one').version, 11);
});

test('cleared draft revision retention never evicts an older unsent attachment draft', () => {
  let raw; const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  saveNativeFiles(storage, 'draft-with-files', { images: [{ id: 'keep.txt', name: 'Unsent' }], version: 1 });
  for (let index = 0; index < 100; index++) saveNativeFiles(storage, 'cleared-' + index, { images: [], version: 4 });
  assert.equal(loadNativeFiles(storage, 'draft-with-files').images[0].id, 'keep.txt');
  assert.equal(new Map(JSON.parse(raw)).size, 65);
});
