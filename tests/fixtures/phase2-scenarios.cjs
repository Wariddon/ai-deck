const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const fs = require('node:fs'), path = require('node:path');

module.exports = async ({ restore, root, cwd, ids, sessions, report, win, js, api, click, type, open, picker, saveOptions, assertOptions, options, draft, wait, hold, holdTurn }) => {
  const settingsVisible = () => js("Boolean(document.querySelector('[aria-label=\"Search settings\"]')?.checkVisibility())");
  const native = key => { const { provider, id } = sessions.find(s => s.key === key); return { provider, id }; };
  const files = () => js("[...document.querySelectorAll('.deck-native-chat .composer-attachments [data-attachment-id]')].map(e=>e.dataset.attachmentId)");
  const attach = async (key, suffix = '') => {
    const image = require('electron').nativeImage.createFromBitmap(Buffer.alloc(16, key.charCodeAt(0) + suffix.length), { width: 2, height: 2 }).toPNG().toString('base64');
    await js(`(()=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(image)}),c=>c.charCodeAt(0))],${JSON.stringify(key+suffix+'.png')},{type:'image/png'}));document.querySelector('.deck-native-chat form').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}))})()`);
    await wait(async () => (await files()).length === 1, 'native file ' + key); return files();
  };
  const snapshots = path.join(root, 'phase2-state.json');
  if (restore) {
    const saved = JSON.parse(fs.readFileSync(snapshots)); Object.assign(options, saved.options);
    for (const key of ['a', 'b', 'c']) {
      await open(key); assert.equal(await draft(), saved.drafts[key]); await assertOptions(key);
      assert.deepEqual(await files(), saved.files[key]);
      assert.equal(saved.files[key].length, 1, 'Restore a real unsent image, not an empty file list');
      assert.equal((await api('native-session-preview', native(key))).chat.permissionMode, saved.permissions[key]);
    }
    assert.equal((await api('state')).jobs.length, 0); assert.equal(report.calls.length, 0);
    await click('Back to workspace');
    assert.equal(await js("document.querySelector('.thread-composer textarea').value"), 'Keep fork draft');
    for (const key of ['a', 'b']) {
      if (!await click('Team draft ' + key)) { await click('Projects'); await wait(() => click('Team draft ' + key), 'restored task ' + key); }
      await wait(async () => (await api('state')).workspace.taskId === ids['task' + key], 'restored task selected');
      assert.equal(await js("document.querySelector('.thread-composer textarea').value"), 'Unsent team draft ' + key);
    }
    report.checks.push('all native drafts, files, permissions and model choices restore without sends'); return;
  }
  const selection = hold('deck:switch-task');
  await click('Projects');
  await wait(() => click('Team draft b'), 'second task');
  await wait(() => selection.entered, 'delayed selection result');
  assert.equal(await click('Settings'), true);
  await wait(settingsVisible, 'settings navigation');
  selection.release();
  await delay(150);
  assert.ok(await settingsVisible(), 'A delayed project selection must not take the user away from Settings');
  report.checks.push('late selection preserves the latest navigation');

  await click('Back to workspace');
  if (!await click('Team draft a')) { await click('Projects'); await wait(() => click('Team draft a'), 'first task'); }
  await wait(async () => (await api('state')).workspace.taskId === ids.taska, 'first task selected');
  const earlier = hold('deck:switch-task', payload => payload.id === ids.taskb);
  await js("(()=>{const buttons=[...document.querySelectorAll('.thread-task-row')];buttons.find(e=>e.textContent.trim()==='Team draft b').click();buttons.find(e=>e.textContent.trim()==='Team draft a').click()})()");
  await wait(() => earlier.entered, 'earlier selection held'); await delay(100);
  assert.ok(await js("document.querySelector('.thread-task-row').disabled"), 'One completed operation cannot unlock controls while the other is still pending');
  earlier.release(); await delay(100);
  assert.equal(await js("document.querySelector('.thread-taskbar h1').textContent"), 'Team draft a');
  assert.equal(await js("document.querySelector('.thread-composer textarea').value"), 'Unsent team draft a');
  report.checks.push('out-of-order task results retain the latest task and overlapping operations retain the busy state');

  // Actual drop/import path; all bytes stay in this private profile.
  const expectedFiles = {};
  for (const key of ['a', 'b', 'c']) {
    await open(key); await picker(key); await saveOptions(key);
    await wait(() => js("!document.querySelector('.deck-native-model-panel:popover-open')"), 'model saved');
    expectedFiles[key] = await attach(key);
    await type('Keep phase2 ' + key);
  }

  await open('a');
  const permission = hold('deck:save-native-chat-permission');
  await click('Change permissions · Chat only');
  assert.equal(await js("(()=>{const e=document.querySelector('.deck-native-chat button[data-permission=ask]');if(!e||e.disabled)return false;e.click();return true})()"), true);
  await wait(() => permission.entered, 'delayed permission result'); await click('Settings'); permission.release();
  await delay(100); assert.ok(await settingsVisible());
  await open('b'); assert.equal(await draft(), 'Keep phase2 b'); await assertOptions('b');
  assert.equal((await api('native-session-preview', native('b'))).chat.permissionMode, 'chat');
  assert.equal((await api('native-session-preview', native('a'))).chat.permissionMode, 'ask');
  report.checks.push('late permission result leaves the new chat and its draft, model and images unchanged');

  // Closing a management dialog and navigating away must not allow a late archive to steal focus.
  await open('a'); await click('Chat actions'); await click('Rename');
  await wait(() => js("Boolean(document.querySelector('.deck-session-actions form input'))"), 'rename input');
  const rename = hold('deck:native-session-action'), newName = 'Renamed phase2 alpha';
  await js(`(()=>{const e=document.querySelector('.deck-session-actions input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(newName)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await js("document.querySelector('.deck-session-actions form').requestSubmit()"); await wait(() => rename.entered, 'rename result');
  await click('Close dialog'); await click('Settings'); rename.release(); await delay(100); assert.ok(await settingsVisible());
  sessions.find(s => s.key === 'a').title = newName;
  await open('a'); assert.equal(await draft(), 'Keep phase2 a'); assert.deepEqual(await files(), expectedFiles.a);
  await click('Manage session ' + newName); await click('Archive');
  const archive = hold('deck:native-session-action'); await js("document.querySelector('.deck-session-actions form').requestSubmit()");
  await wait(() => archive.entered, 'archive result'); await click('Close dialog'); await click('Settings'); archive.release();
  await delay(100); assert.ok(await settingsVisible(), 'A late archive must not replace the new page');
  await api('native-session-action', { ...native('a'), action: 'restore' });
  await click('Back to workspace'); await click('Recents');
  assert.equal(await click('Recent chat controls'), true); assert.equal(await click('Pull sessions'), true);
  await wait(() => click('Codex: ' + newName), 'restored source');
  await wait(() => js("Boolean(document.querySelector('.deck-native-chat textarea'))"), 'restored composer');
  report.checks.push('rename and archive preserve newer navigation, source identity, draft and files');

  const a = holdTurn('codex', true), c = holdTurn('claude', true);
  await open('a'); await type('Held native alpha'); await click('Send'); await wait(() => a.entered, 'alpha provider');
  await open('c'); await type('Held native Claude'); await click('Send'); await wait(() => c.entered, 'Claude provider');
  await wait(() => js("[...document.querySelectorAll('.thread-approval strong')].some(e=>e.textContent.includes('claude scoped'))"), 'Claude approval');
  assert.ok(!await js("[...document.querySelectorAll('.thread-approval strong')].some(e=>e.textContent.includes('codex scoped'))"));
  fs.writeFileSync(path.join(root, 'phase2-controls.png'), (await win.webContents.capturePage()).toPNG());
  assert.equal(await click('Approve once'), true); await wait(() => report.controls?.length === 1, 'Claude decision');
  assert.equal(report.controls[0].provider, 'claude'); assert.equal(report.controls[0].id, ids.a);
  await open('b'); await type('Keep phase2 b while others run'); assert.ok(!await click('Stop'));
  await click('Back to workspace');
  if (!await click('other-project')) { await click('Projects'); await wait(() => click('other-project'), 'other project'); }
  await wait(async () => (await api('state')).workspace.taskId === ids.other, 'project selected');
  assert.equal(await js("document.querySelector('.thread-composer textarea').value"), 'Keep other project');
  c.release();
  await wait(async () => !(await api('state')).jobs.some(j => j.key === 'native:claude:' + ids.a), 'background Claude finished');
  assert.equal(await js("document.querySelector('.thread-composer textarea').value"), 'Keep other project');
  await open('a'); assert.equal(await click('Stop'), true); await wait(() => report.controls.some(r => r.kind === 'stop'), 'alpha stop');
  assert.deepEqual(report.controls.map(r => [r.provider, r.kind]), [['claude', 'approval'], ['codex', 'stop']]);
  await wait(async () => !(await api('state')).jobs.length, 'native jobs ended');
  report.checks.push('same native ID and approval key on two providers keep approvals, Stop, files and replies scoped across projects');

  // Recents -> Ask -> team -> fork while a different native chat is still answering.
  await api('save-agent-settings', { scope: 'default', agent: 'codex', options: { model: 'gpt-fixture-a', effort: 'low', speed: 'standard' } });
  await api('save-agent-settings', { scope: 'default', agent: 'claude', options: { model: 'sonnet', effort: 'low', speed: 'standard' } });
  const held = holdTurn('codex'); await open('b'); await type('Held beta during team'); await click('Send'); await wait(() => held.entered, 'beta held');
  await click('Back to workspace'); await type('Phase2 Ask request', '.thread-composer textarea');
  await click('Ask'); await js("[...document.querySelectorAll('.deck-ask-picker button')].find(e=>e.textContent.trim()==='Claude Code').click()");
  await click('Send'); await wait(() => report.calls.some(r => r.provider === 'claude' && r.id !== ids.a), 'Ask provider');
  await wait(async () => !(await api('state')).jobs.some(j => j.taskId === ids.other), 'Ask finished');
  await click('Ask Claude Code'); await click('Current workflow');
  await type('Phase2 team request', '.thread-composer textarea'); await click('Send');
  await wait(async () => (await api('state')).workspace.runHistory.length === 2 && !(await api('state')).running, 'team finished');
  const before = report.calls.length, taskCount = (await api('state')).recent.reduce((n, project) => n + project.tasks.length, 0);
  await open('c'); await click('Chat actions'); await click('Fork to Team');
  await wait(() => js("!document.querySelector('.deck-native-chat')&&Boolean(document.querySelector('.thread-composer textarea')?.checkVisibility())"), 'fork composer');
  assert.equal(report.calls.length, before, 'Fork never sends a model request');
  assert.equal((await api('state')).recent.reduce((n, project) => n + project.tasks.length, 0), taskCount + 1);
  await type('Keep fork draft', '.thread-composer textarea'); held.release();
  await wait(async () => !(await api('state')).jobs.length, 'beta finished in background');
  assert.equal(await js("document.querySelector('.thread-composer textarea').value"), 'Keep fork draft');
  report.checks.push('Recents Ask team and fork navigation preserves background replies without extra provider calls');

  // A waiting message keeps the selected snapshot; a subsequent message uses the newly saved selection.
  await api('save-low-memory', true);
  const first = holdTurn('codex'); await open('b'); await type('Hold low RAM slot'); await click('Send'); await wait(() => first.entered, 'slot held');
  await open('c'); const queuedFiles = await attach('c', '-queue'); await type('Queued Claude selected snapshot'); await click('Send');
  await wait(async () => (await api('state')).jobs.some(j => j.key === 'native:claude:' + ids.a && j.state === 'waiting'), 'Claude queued');
  const frozen = await api('native-session-preview', native('c'));
  await assert.rejects(api('save-native-chat-models', { ...native('c'), revision: frozen.chat.revision, modelStamp: frozen.chat.modelStamp, options: { model: 'sonnet', effort: 'high', speed: 'standard' } }), /finish before changing/);
  await assert.rejects(api('save-native-chat-permission', { ...native('c'), revision: frozen.chat.revision, mode: 'full' }), /finish before changing/);
  await api('save-agent-settings', { scope: 'default', agent: 'claude', options: { model: 'sonnet', effort: 'high', speed: 'standard' } });
  first.release(); await wait(async () => !(await api('state')).jobs.length, 'queued completion');
  const queued = report.calls.find(r => r.provider === 'claude' && r.prompt.includes('Queued Claude selected snapshot'));
  assert.equal(queued.model, 'sonnet'); assert.equal(queued.effort, 'low'); assert.equal(queued.speed, 'standard');
  assert.deepEqual(queued.images, queuedFiles);
  await open('c'); options.c.effort = 'high'; await picker('c'); await saveOptions('c');
  await wait(() => js("!document.querySelector('.deck-native-model-panel:popover-open')"), 'new Claude selection');
  await type('New Claude selection'); await click('Send'); await wait(async () => !(await api('state')).jobs.length, 'new selected reply');
  assert.equal(report.calls.at(-1).effort, 'high');
  assert.equal(report.calls.filter(r => r.prompt.includes('Queued Claude selected snapshot')).length, 1);

  const second = holdTurn('claude'); await open('c'); await type('Hold Claude slot'); await click('Send'); await wait(() => second.entered, 'Claude slot');
  await open('b'); const codexFiles = await attach('b', '-queue'); await type('Queued Codex selected snapshot'); await click('Send');
  await wait(async () => (await api('state')).jobs.some(j => j.key === 'native:codex:' + ids.b && j.state === 'waiting'), 'Codex queued');
  const beta = await api('native-session-preview', native('b'));
  await assert.rejects(api('save-native-chat-models', { ...native('b'), revision: beta.chat.revision, modelStamp: beta.chat.modelStamp, options: {} }), /finish before changing/);
  await assert.rejects(api('save-native-chat-permission', { ...native('b'), revision: beta.chat.revision, mode: 'full' }), /finish before changing/);
  second.release(); await wait(async () => !(await api('state')).jobs.length, 'queued Codex completion');
  const queuedCodex = report.calls.find(r => r.provider === 'codex' && r.prompt.includes('Queued Codex selected snapshot'));
  assert.equal(queuedCodex.model, 'gpt-fixture-b'); assert.equal(queuedCodex.effort, 'high'); assert.equal(queuedCodex.speed, 'fast'); assert.deepEqual(queuedCodex.images, codexFiles);
  await open('b'); options.b = { model: 'gpt-fixture-a', effort: 'low', speed: 'standard' }; await picker('b'); await saveOptions('b');
  await wait(() => js("!document.querySelector('.deck-native-model-panel:popover-open')"), 'new Codex selection');
  await type('New Codex selection'); await click('Send'); await wait(async () => !(await api('state')).jobs.length, 'new Codex reply');
  assert.equal(report.calls.at(-1).model, 'gpt-fixture-a'); assert.equal(report.calls.at(-1).effort, 'low'); assert.equal(report.calls.at(-1).speed, 'standard');
  assert.equal(report.calls.filter(r => r.prompt.includes('Queued Codex selected snapshot')).length, 1);
  report.checks.push('waiting messages freeze model effort speed permissions and file references; new messages use new choices exactly once');

  const saved = { options, drafts: {}, files: {}, permissions: {} };
  for (const key of ['a', 'b', 'c']) {
    await open(key); await attach(key, '-restore'); await type('Final phase2 draft ' + key); saved.drafts[key] = await draft();
    saved.files[key] = await files(); saved.permissions[key] = (await api('native-session-preview', native(key))).chat.permissionMode;
    await assertOptions(key);
  }
  fs.writeFileSync(snapshots, JSON.stringify(saved)); report.exactNativeIds = true;
};
