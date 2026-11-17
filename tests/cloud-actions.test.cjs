const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createCloudActions, cloudIntent } = require('../desktop/cloud-actions.cjs');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-cloud-')); let calls = [], approved = [], changed = false;
  const options = { cwd: root, directory: root, executables: { codex: 'codex.exe', claude: 'claude.exe' },
    git: async (_, args) => args[0] === 'rev-parse' ? 'head' : args[0] === 'status' ? changed ? ' M file' : '' : 'https://github.com/test/repo.git',
    approve: async value => { approved.push(value); return true; },
    run: async (exe, args) => { calls.push({ exe, args }); return { code: 0, stdout: JSON.stringify({ ok: true, session_id: 'session_12345678', url: 'https://claude.ai/code/session_12345678' }) }; } };
  return { root, options, calls, approved, change: () => { changed = true; }, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('Cloud writes require explicit normal-chat intent; reads do not create work', () => {
  assert.equal(cloudIntent('Read Codex Cloud task status'), false);
  assert.equal(cloudIntent('ส่งงานนี้ไป Claude Cloud'), true);
  assert.equal(cloudIntent('Create a Codex Cloud task'), true);
  assert.equal(cloudIntent('run this code locally'), false);
});
test('interactive-only Claude creation fails before approval, dispatch or a false uncertain receipt', async () => {
  const f = fixture();
  try {
    await assert.rejects(createCloudActions(f.options).execute({ action: 'create', prompt: 'Create cloud work' }, 'claude', 'unsupported-create'), /interactive-only/);
    assert.equal(f.calls.length, 0); assert.equal(f.approved.length, 0); assert.equal(fs.existsSync(path.join(f.root, 'cloud-receipts.json')), false);
  } finally { f.close(); }
});
test('Claude Cloud follow-up uses same remote ID, approval and durable duplicate protection across restart', async () => {
  const f = fixture();
  try {
    const args = { action: 'follow-up', id: 'session_12345678', prompt: 'Continue the approved check.' };
    assert.equal((await createCloudActions(f.options).execute(args, 'claude', 'stable-message')).status, 'sent');
    assert.equal((await createCloudActions(f.options).execute(args, 'claude', 'stable-message')).duplicate, true);
    assert.equal(f.approved.length, 1); assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].args, ['-p', args.prompt, '--cloud', args.id, '--output-format', 'json']);
    await assert.rejects(createCloudActions(f.options).execute({ ...args, prompt: 'different' }, 'claude', 'stable-message'), /changed after delivery/);
  } finally { f.close(); }
});
test('Cloud timeouts stay uncertain and changed checkouts never reach the write command', async () => {
  const f = fixture();
  try {
    const args = { action: 'create', environment: 'env_1234', prompt: 'Run one check.' };
    let calls = 0;
    const options = { ...f.options, run: async () => { calls++; throw Error('Disconnected'); } };
    assert.equal((await createCloudActions(options).execute(args, 'codex', 'timeout-message')).status, 'uncertain');
    assert.equal((await createCloudActions(options).execute(args, 'codex', 'timeout-message')).duplicate, true); assert.equal(calls, 1);
    await assert.rejects(createCloudActions({ ...f.options, approve: async () => { f.change(); return true; } }).execute(args, 'codex', 'changed-message'), /checkout changed/);
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});
