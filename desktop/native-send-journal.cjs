const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { nativeChatDelivery } = require('./native-chat-delivery.mjs');
const { nativeFolderKey } = require('./native-chat-policy.mjs');

const states = new Set(['waiting', 'preparing', 'dispatched', 'saved', 'replied', 'not-sent']);
const confirmed = record => ['saved', 'replied'].includes(record.status);
const requestPattern = /^[a-z\d-]{16,80}$/iu;

// One small atomic checkpoint per native chat, outside the large workspace file.
// Reads never dispatch a provider turn. Uncertain sends are never evicted.
class NativeSendJournal {
  constructor(profile) { this.directory = path.join(profile, 'native-send-checkpoints'); }
  filename(entry) {
    if (!['codex', 'claude'].includes(entry.provider) || typeof entry.id !== 'string' || !entry.id || entry.id.length > 200) throw Error('Invalid original chat.');
    return path.join(this.directory, createHash('sha256').update(entry.provider + ':' + entry.id).digest('hex') + '.json');
  }
  read(entry, cwd) {
    let data;
    try { data = JSON.parse(fs.readFileSync(this.filename(entry), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return { version: 1, key: entry.provider + ':' + entry.id, cwd, records: [] };
      throw Error('The saved send checkpoint could not be read. Keep this draft and check local storage before sending.', { cause: error });
    }
    if (data.version !== 1 || data.key !== entry.provider + ':' + entry.id || nativeFolderKey(data.cwd) !== nativeFolderKey(cwd) ||
        !Array.isArray(data.records) || data.records.some(record => !requestPattern.test(record.requestId) || !states.has(record.status) ||
          typeof record.prompt !== 'string' || !Array.isArray(record.previousIds))) {
      throw Error('The saved send checkpoint or original folder changed. Check this chat before sending.');
    }
    return data;
  }
  write(entry, data) {
    const filename = this.filename(entry);
    fs.mkdirSync(this.directory, { recursive: true });
    fs.writeFileSync(filename + '.tmp', JSON.stringify(data));
    fs.renameSync(filename + '.tmp', filename);
  }
  begin(entry, cwd, value) {
    if (!requestPattern.test(value.requestId) || typeof value.prompt !== 'string') throw Error('Refresh this chat before sending.');
    const data = this.read(entry, cwd);
    if (data.records.some(record => record.requestId === value.requestId || value.draftToken && record.draftToken === value.draftToken && record.status !== 'not-sent')) {
      throw Error('Refresh messages to check this previously submitted message. It will not be sent twice.');
    }
    if (data.records.some(record => record.status === 'dispatched' && record.prompt === value.prompt)) {
      throw Error('The previous matching send is unconfirmed. Refresh messages before repeating it.');
    }
    const settled = data.records.filter(record => confirmed(record) || record.status === 'not-sent').slice(-31);
    const pending = data.records.filter(record => !confirmed(record) && record.status !== 'not-sent');
    // A live run-pool lock normally limits this to one. Fail closed for stale callers.
    if (pending.length >= 16) throw Error('Refresh the unresolved sends in this chat before sending more messages.');
    const record = { ...value, previousIds: [], status: 'waiting', at: new Date().toISOString() };
    data.records = [...settled, ...pending, record];
    this.write(entry, data);
    return record;
  }
  update(entry, cwd, requestId, changes) {
    const data = this.read(entry, cwd), record = data.records.find(record => record.requestId === requestId);
    if (!record) throw Error('The original send checkpoint is unavailable. Refresh messages before sending.');
    if (confirmed(record) && changes.status && !confirmed(changes)) delete changes.status;
    Object.assign(record, changes);
    this.write(entry, data);
    return record;
  }
  reconcile(entry, cwd, page) {
    const data = this.read(entry, cwd);
    let changed = false;
    for (const record of data.records) {
      if (record.status !== 'dispatched' && !confirmed(record)) continue;
      const delivery = nativeChatDelivery({ prompt: record.wirePrompt ?? record.prompt, wirePrefix: record.wirePrefix,
        previousIds: new Set(record.previousIds) }, page.messages);
      if (delivery && record.status !== 'replied' && record.status !== delivery) { record.status = delivery; changed = true; }
    }
    if (changed) this.write(entry, data);
    return data.records.at(-1);
  }
  remove(entry) {
    const filename = this.filename(entry);
    fs.rmSync(filename, { force: true }); fs.rmSync(filename + '.tmp', { force: true });
  }
}

module.exports = { NativeSendJournal };
