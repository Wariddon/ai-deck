const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
module.exports = async ({ restore, root, profile, report, js, api, click, type, open, saveOptions, picker, assertOptions, options, draft, wait, hold, holdTurn, ids }) => {
  await api('pull-native-recents');
  const checkpoints = path.join(root, 'race-drafts.json');
  if (restore) {
    const expected = JSON.parse(fs.readFileSync(checkpoints));
    for (const key of ['a', 'b', 'c']) { await open(key); assert.equal(await draft(), expected[key]); await assertOptions(key); }
    assert.equal((await api('state')).jobs.length, 0); assert.equal(report.calls.length, 0);
    await click('Back to workspace'); assert.equal(await js("document.querySelector('.thread-composer textarea').value"), 'Unsent team draft a');
    assert.deepEqual((await api('state')).workspace.agentModels.codex, { model: 'gpt-fixture-b', effort: 'low', speed: 'fast' });
    report.checks.push('restart preserves task/native controls and all distinct drafts without replay'); return;
  }
  await open('a'); await picker('a'); await saveOptions('a');
  await wait(() => js("!document.querySelector('.deck-native-model-panel:popover-open')"), 'native choices saved');
  const native = holdTurn('codex'); await type('Native race before model save'); await click('Send'); await wait(() => native.entered, 'held native');
  await type('Keep newer native draft');
  await click('Back to workspace');
  assert.equal(await js("document.querySelector('.thread-composer textarea').value"), 'Unsent team draft a');
  assert.equal(await click('Run options'), true); assert.equal(await click('Codex model and effort'), true);
  const setControl = async (label, value) => {
    assert.equal(await js(`(()=>{const e=[...document.querySelectorAll('.live-plugin-form label')].find(e=>e.querySelector('strong')?.textContent===${JSON.stringify(label)})?.querySelector('select');if(!e||e.disabled)return false;e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`), true, label);
    await delay(25);
  };
  await wait(() => js("[...document.querySelectorAll('.live-plugin-form select option')].some(e=>e.value==='gpt-fixture-b')"), 'task catalog');
  await setControl('Model', 'gpt-fixture-b'); await setControl('Reasoning effort', 'low'); await setControl('Speed', 'fast');
  const save = hold('deck:save-agent-settings'); assert.equal(await click('Save for task'), true); await wait(() => save.entered, 'model result held');
  native.release(); await wait(async () => !(await api('state')).jobs.length, 'background native finishes');
  await delay(60); save.release(); await wait(() => js("!document.querySelector('[role=dialog]')"), 'model save closes');
  assert.equal(await js("document.querySelector('.thread-composer textarea').value"), 'Unsent team draft a');
  assert.ok(await js("document.querySelectorAll('.thread-native-row').length>0"), 'Native rows are observable');
  assert.equal(await js("document.querySelectorAll('.thread-job-spinner').length"), 0, 'Late model result must not revive a completed job');
  const state = JSON.parse(fs.readFileSync(path.join(profile, 'workspace-state.json'))), task = Object.values(state.workspaces)[0].tasks[0];
  assert.deepEqual(task.agentModels.codex, { model: 'gpt-fixture-b', effort: 'low', speed: 'fast' });
  await open('a'); assert.equal(await draft(), 'Keep newer native draft');
  assert.equal(report.calls.length, 1); report.checks.push('late task-model save keeps completed jobs cleared, original native draft and selected controls');
  for (const key of ['b', 'c']) { await open(key); await picker(key); await saveOptions(key); await wait(() => js("!document.querySelector('.deck-native-model-panel:popover-open')"), 'save ' + key); }
  const submit = async (key, prompt) => { await open(key); await type(prompt); await js("document.querySelector('.deck-native-chat form').requestSubmit();document.querySelector('.deck-native-chat form').requestSubmit()"); };
  const a = holdTurn('codex'); await submit('a', 'Concurrent native a'); await wait(() => a.entered, 'native a active');
  const c = holdTurn('claude'); await submit('c', 'Concurrent native c'); await wait(() => c.entered, 'native c active');
  const b = holdTurn('codex'); await submit('b', 'Concurrent native b queued');
  await wait(async () => (await api('state')).jobs.some(job => job.key === 'native:codex:' + ids.b && job.state === 'waiting'), 'native b waiting');
  assert.equal(report.calls.length, 3); assert.equal(b.entered, false);
  const preview = await api('native-session-preview', { provider: 'codex', id: ids.b });
  await assert.rejects(api('save-native-chat-models', { provider: 'codex', id: ids.b, options: options.a, revision: preview.chat.revision, modelStamp: preview.chat.modelStamp }), /running|waiting|finish|active|job/i);
  c.release(); await wait(() => b.entered, 'waiting b starts'); assert.equal(a.stopped, undefined);
  const expected = {}, typing = [];
  await open('a');
  for (let burst = 0; burst < 6; burst++) {
    for (let i = 0; i < 40; i++) { a.emit({ type: 'activity', text: 'A work ' + burst + ':' + i }); b.emit({ type: 'activity', text: 'B work ' + burst + ':' + i }); }
    typing.push(await js(`(async()=>{const began=performance.now(),e=document.querySelector('.deck-native-chat textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Live draft ${burst}');e.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return performance.now()-began})()`));
  }
  report.liveTyping = { events: 480, samplesMs: typing };
  for (let i = 0; i < 4; i++) for (const key of ['a', 'b', 'c']) { await open(key); await type('Separate draft ' + key + ' ' + i); expected[key] = await draft(); }
  a.release(); b.release(); await wait(async () => !(await api('state')).jobs.length, 'all native peers finish');
  for (const key of ['a', 'b', 'c']) { await open(key); assert.equal(await draft(), expected[key]); await assertOptions(key); }
  assert.equal(report.calls.length, 4);
  for (const [index, key] of ['a', 'a', 'c', 'b'].entries()) {
    const actual = report.calls[index];
    for (const field of ['model', 'effort', 'speed']) assert.equal(actual[field], options[key][field], key + ' ' + field);
    assert.equal(actual.id, key === 'b' ? ids.b : ids.a); assert.equal(actual.provider, key === 'c' ? 'claude' : 'codex');
  }
  fs.writeFileSync(checkpoints, JSON.stringify(expected));
  report.checks.push('two native jobs and one waiter preserve selected models and drafts through rapid switches and duplicate submit attempts');
};
