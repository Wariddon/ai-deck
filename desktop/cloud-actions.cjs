const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { capture } = require('./engines.cjs');
const { abortableRead } = require('./abortable-read.cjs');
const stamp = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pendingJournals = new Set();
function cloudIntent(prompt) {
  return typeof prompt === 'string' && /(?:codex|claude|คลาวด์|cloud)/iu.test(prompt) &&
    /(?:cloud|คลาวด์)/iu.test(prompt) && /(?:สร้าง|ส่ง|รัน|เริ่ม|นำ.*(?:กลับ|ใช้)|apply|create|start|run|send|queue)/iu.test(prompt);
}
function createCloudActions({ directory, cwd, git, executables, approve, signal, run = capture }) {
  const root = fs.realpathSync.native(cwd), journal = path.join(directory, 'cloud-receipts.json');
  let busy = false;
  function read() {
    try { const data = JSON.parse(fs.readFileSync(journal, 'utf8')); if (Array.isArray(data) && data.length <= 2000) return data; } catch (e) { if (e.code === 'ENOENT') return []; }
    throw Error('Cloud delivery journal is unavailable. No request was sent.');
  }
  function save(records) {
    fs.mkdirSync(directory, { recursive: true }); const tmp = journal + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(records), { mode: 0o600 }); fs.renameSync(tmp, journal);
  }
  async function execute(args, provider, requestKey, actor) {
    signal?.throwIfAborted();
    if (busy || pendingJournals.has(journal)) throw Error('A Cloud action is already pending.');
    busy = true; pendingJournals.add(journal);
    try {
      if (!['codex', 'claude'].includes(provider) || !executables[provider]) throw Error('Connect the selected Cloud provider first.');
      if (provider === 'claude' && args.action === 'create') throw Error('Claude Cloud creation is interactive-only in this CLI. Start it in Claude, then paste its Cloud session ID here to continue through AI Deck. No task was created.');
      if (!['create', 'follow-up', 'apply'].includes(args.action) || args.action === 'follow-up' && provider !== 'claude' || args.action === 'apply' && provider !== 'codex') throw Error('Choose a supported native Cloud action.');
      if (!/^[a-z0-9_-]{8,160}$/iu.test(requestKey ?? '')) throw Error('Cloud actions need a stable request key.');
      if (args.action !== 'apply' && (typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 12000)) throw Error('Describe the Cloud request.');
      if (args.action !== 'create' && !/^[a-z0-9][a-z0-9_-]{0,119}$/iu.test(args.id ?? '')) throw Error('Choose a valid Cloud task ID.');
      if (provider === 'claude' && args.action === 'follow-up' && !/^(?:session|cse)_[a-z0-9]+$/iu.test(args.id)) throw Error('Use the original Claude Cloud session ID.');
      if (provider === 'codex' && args.action === 'create' && !/^[a-z0-9][a-z0-9_-]{0,119}$/iu.test(args.environment ?? '')) throw Error('Include your Codex Cloud environment ID in this chat. AI Deck will not guess an environment.');
      const key = stamp([root.toLowerCase(), provider, requestKey]), digest = stamp(args), records = read();
      const old = records.find(r => r.key === key);
      if (old) {
        if (old.digest !== digest) throw Error('This Cloud request changed after delivery. Start a new message.');
        return { duplicate: true, status: old.status, id: old.id, text: old.text ?? 'Delivery is uncertain. Check the original Cloud session before trying again.' };
      }
      if (records.length >= 2000) throw Error('Cloud delivery history is full. No request was sent.');
      const snapshot = async () => [await git(root, ['rev-parse', 'HEAD']), await git(root, ['status', '--porcelain=v1', '-z']), await git(root, ['remote', 'get-url', 'origin'])];
      const before = await snapshot();
      if (args.action !== 'follow-up' && before[1]) throw Error('Cloud creation and apply require a clean task checkout. Commit or keep local work in another task first.');
      let diff;
      if (args.action === 'apply') {
        const result = await run(executables.codex, ['cloud', 'diff', args.id], { cwd: root, signal, timeout: 15000, limit: 64000 });
        if (result.code !== 0 || !result.stdout || result.stdout.length > 60000) throw Error('Read and review a bounded Cloud diff before applying it.');
        diff = result.stdout;
      }
      const summary = args.action + ' ' + provider + ' Cloud' + (args.id ? ' · ' + args.id : ' · environment ' + args.environment);
      if (!await approve({ provider, actor, summary, text: [root, before[2].trim(), args.prompt, diff].filter(Boolean).join('\n\n') })) return { status: 'declined', text: 'Cloud action declined. No request was sent.' };
      signal?.throwIfAborted();
      if (stamp(await snapshot()) !== stamp(before)) throw Error('The checkout changed after Cloud approval. Review the request again.');
      if (diff) {
        const current = await run(executables.codex, ['cloud', 'diff', args.id], { cwd: root, signal, timeout: 15000, limit: 64000 });
        if (current.code !== 0 || current.stdout !== diff) throw Error('The Cloud diff changed after approval. Review it again.');
      }
      const record = { key, digest, provider, action: args.action, id: args.id, at: new Date().toISOString(), status: 'uncertain' };
      records.push(record); save(records); // Before invoking the native command: a timeout never retries a write.
      const argv = provider === 'codex' ? args.action === 'apply' ? ['cloud', 'apply', args.id]
        : ['cloud', 'exec', '--env', args.environment, '--attempts', '1', args.prompt]
        : ['-p', args.prompt, '--cloud', args.id, '--output-format', 'json'];
      const controller = new AbortController(), cancel = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => controller.abort(Error('Cloud command timed out.')), 30000);
      try {
        const result = await abortableRead(() => run(executables[provider], argv, { cwd: root, signal: controller.signal, timeout: 30000, limit: 64000 }), controller.signal);
        if (result.code !== 0) throw Error('The native Cloud command did not confirm delivery.');
        const text = result.stdout.slice(0, 16000);
        let parsed; try { parsed = JSON.parse(text); } catch {}
        const id = parsed?.session_id ?? /(?:session_|cse_|task_)[a-z0-9_-]+/iu.exec(text)?.[0] ?? args.id;
        if (provider === 'claude' && args.action === 'follow-up' && (parsed?.ok !== true || id !== args.id)) throw Error('Claude did not acknowledge the original Cloud session.');
        if (args.action === 'create' && !id) throw Error('The provider did not return a Cloud ID.');
        Object.assign(record, { status: args.action === 'apply' ? 'applied' : 'sent', id, text }); save(records);
        return { status: record.status, id, text, source: provider + ' native Cloud CLI' };
      } catch {
        return { status: 'uncertain', id: record.id, text: 'The native command did not confirm delivery. AI Deck recorded this request and will not send it again. Check the provider Cloud page or task list first.' };
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    } finally { busy = false; pendingJournals.delete(journal); }
  }
  return { execute };
}
module.exports = { createCloudActions, cloudIntent };
