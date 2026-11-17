const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const appDir = process.env.AI_DECK_QA_APP || path.resolve(__dirname, '../desktop');
const { nativeChromeRequested, nativeChromeDecision, chromePrefix } = require(path.join(appDir, 'native-capabilities.cjs'));
const { createWindowTools } = require(path.join(appDir, 'computer-use.cjs'));
// A Node-only package probe never exercises Electron's native image binding.
const Module = require('node:module');
const originalLoad = Module._load;
let readNativeCloud;
try {
  if (process.env.AI_DECK_QA_APP) Module._load = function(name, ...args) {
    return name === 'electron' ? { nativeImage: {} } : originalLoad.call(this, name, ...args);
  };
  ({ readNativeCloud } = require(path.join(appDir, 'native-cloud.cjs')));
} finally { Module._load = originalLoad; }
const { recordingBytes, voiceProcess } = require(path.join(appDir, 'voice.cjs'));

test('browser intent excludes source-code words and keeps explicit native browser requests', () => {
  for (const prompt of ['Check edge cases', 'Read knowledge', 'Inspect chromeOptions in code', 'Read edgedb settings', 'ทดสอบ edge cases ให้ครบ']) {
    assert.equal(nativeChromeRequested(prompt), false, prompt);
  }
  for (const prompt of ['Open Edge', 'Inspect Microsoft Edge', 'ช่วยเปิด Chrome เช็กหน้าเว็บ', '@Chrome ดูแท็บนี้']) {
    assert.equal(nativeChromeRequested(prompt), true, prompt);
  }
});

test('listing tabs never silently creates one, even with full file access', () => {
  assert.equal(nativeChromeDecision(chromePrefix + 'tabs_context_mcp', { createIfEmpty: true }), 'ask');
  assert.equal(nativeChromeDecision(chromePrefix + 'tabs_context_mcp', { createIfEmpty: false }), 'allow');
  assert.equal(nativeChromeDecision(chromePrefix + 'tabs_create_mcp', {}), 'ask');
  assert.equal(nativeChromeDecision(chromePrefix + 'computer', { action: 'left_click_drag', start_coordinate: [1, 2], coordinate: [3, 4] }), 'ask');
  assert.equal(nativeChromeDecision(chromePrefix + 'tabs_context_mcp', {}, false), 'deny');
});

function windowFixture(options = {}) {
  const applied = [];
  const tools = createWindowTools({
    target: { handle: '123', identity: 'fixture', title: 'Window A' }, enabled: () => true,
    readWindow: async () => ({ title: 'Window A' }), report() {}, approve: async () => true,
    ui: async request => request.action === 'inspect'
      ? { controls: [{ key: 'only-A', label: 'Test', invoke: true, set: true }] }
      : (applied.push(request), { applied: true }), ...options,
  });
  return { tools, applied };
}

test('closing a shared window settles a pending approval without applying an action', async () => {
  let asked;
  const pending = new Promise(resolve => { asked = resolve; });
  const { tools, applied } = windowFixture({ approve: () => { asked(); return new Promise(() => {}); } });
  await tools.call('inspect', {});
  const action = tools.call('invoke', { controlId: 1 });
  const settled = assert.rejects(action, /access has ended/);
  await pending;
  tools.close();
  await settled;
  assert.deepEqual(applied, []);
});

test('stale controls cannot execute before or after an approval delay', async () => {
  let now = 100;
  const { tools, applied } = windowFixture({ now: () => now });
  await tools.call('inspect', {});
  now += 30001;
  await assert.rejects(tools.call('invoke', { controlId: 1 }), /expired/);
  tools.close();
  const delayed = windowFixture({ now: () => now, approve: async () => { now += 30001; return true; } });
  await delayed.tools.call('inspect', {});
  await assert.rejects(delayed.tools.call('set_text', { controlId: 1, text: 'test' }), /expired/);
  assert.deepEqual(applied, []); assert.deepEqual(delayed.applied, []);
  delayed.tools.close();
});

test('independent windows never reuse each other control observations', async () => {
  const a = windowFixture(), b = windowFixture({ target: { handle: '456', identity: 'B', title: 'Window B' } });
  try {
    await a.tools.call('inspect', {});
    await assert.rejects(b.tools.call('invoke', { controlId: 1 }), /Inspect/);
    await a.tools.call('invoke', { controlId: 1 });
    assert.equal(a.applied[0].handle, '123'); assert.equal(b.applied.length, 0);
    await assert.rejects(a.tools.call('drag', { x: 1, y: 2 }), /Invalid/);
  } finally { a.tools.close(); b.tools.close(); }
});

test('Cloud deadline settles even if its CLI reader ignores cancellation', async () => {
  let signal;
  await assert.rejects(readNativeCloud('fixture.exe', {}, { timeout: 30, run: (_exe, _argv, options) => {
    signal = options.signal; return new Promise(() => {});
  } }), /timed out/);
  assert.equal(signal.aborted, true);
});

test('Cloud cancellation discards late results and never dispatches writes', async () => {
  const controller = new AbortController();
  let release, calls = 0;
  const result = readNativeCloud('fixture.exe', {}, { signal: controller.signal, run: () => {
    calls++; return new Promise(resolve => { release = resolve; });
  } });
  await new Promise(setImmediate);
  controller.abort(new Error('Stopped Cloud read'));
  await assert.rejects(result, /Stopped Cloud read/);
  release({ code: 0, stdout: '{"tasks":[]}' });
  for (const action of ['exec', 'apply', 'delete', 'cancel']) {
    await assert.rejects(readNativeCloud('fixture.exe', { action }, { run: () => { calls++; } }), /read-only/);
  }
  assert.equal(calls, 1);
});

test('malformed and repeated Cloud rows cannot break or duplicate the list', async () => {
  const value = await readNativeCloud('fixture.exe', {}, { run: async () => ({ code: 0,
    stdout: JSON.stringify({ tasks: [null, { id: 'task_1', title: 'A' }, { id: 'task_1', title: 'duplicate' }, { id: '--bad' }] }) }) });
  assert.deepEqual(value.tasks.map(task => task.title), ['A']);
  await assert.rejects(readNativeCloud('fixture.exe', {}, { run: async () => ({ code: 0, stdout: 'null' }) }), /supported Cloud task list/);
});

test('voice accepts only bounded mono PCM and rejects another rate or malformed data', () => {
  const pcm = Buffer.alloc(46);
  pcm.write('RIFF'); pcm.writeUInt32LE(38, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(16000, 24);
  pcm.writeUInt32LE(32000, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36); pcm.writeUInt32LE(2, 40);
  assert.deepEqual(recordingBytes(pcm), pcm);
  pcm.writeUInt32LE(48000, 24);
  assert.throws(() => recordingBytes(pcm), /decode/);
  assert.throws(() => recordingBytes(Buffer.alloc(960046)), /30 seconds/);
});

test('voice helper failures, cancellation and timeout settle after owned-process cleanup', { timeout: 15000 }, async () => {
  const failed = new AbortController();
  await assert.rejects(voiceProcess(path.join(__dirname, 'missing-voice.exe'), [], failed.signal, 6000, 'missing voice helper'), /missing voice helper/);
  const controller = new AbortController();
  const running = voiceProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], controller.signal, 6000, 'voice failed');
  controller.abort();
  await assert.rejects(running, /Voice cancelled/);
  await assert.rejects(voiceProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], new AbortController().signal, 100, 'voice failed'), /timed out/);
});
