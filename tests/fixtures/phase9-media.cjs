// Real Electron main/preload/renderer and IPC; controlled media and provider metadata.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { app, ipcMain, desktopCapturer, nativeImage } = require('electron');
app.disableHardwareAcceleration();
const root = process.env.AI_DECK_QA_ROOT, appDir = process.env.AI_DECK_QA_APP;
const profile = process.env.AI_DECK_PROFILE_DIRECTORY = path.join(root, 'profile');
process.env.CODEX_HOME = path.join(root, 'codex'); process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
for (const dir of [profile, process.env.CODEX_HOME, process.env.CLAUDE_CONFIG_DIR]) fs.mkdirSync(dir, { recursive: true });
const { newTask } = require(path.join(appDir, 'tasks.cjs'));
const a = newTask(), b = newTask(), otherRepoTask = { ...newTask(), id: a.id };
const repos = ['conversation:media-A', 'conversation:media-B'];
const workspaces = Object.fromEntries(repos.map((repo, index) => [repo, { repo, chatOnly: true, tasks: index ? [otherRepoTask] : [a, b],
  currentTask: a.id, notes: [], plugins: [], instructions: '' }]));
const executables = {};
for (const provider of ['codex', 'claude']) { executables[provider] = path.join(root, provider + '.exe'); fs.writeFileSync(executables[provider], 'fixture'); }
fs.writeFileSync(path.join(profile, 'workspace-state.json'), JSON.stringify({ executables, currentRepo: repos[0], closeToTray: false,
  preferences: { notifications: 'off' }, workspaces }));
const result = { cases: [], modelCalls: 0, mediaCalls: 0, aborted: 0, passed: false };
const engines = require(path.join(appDir, 'engines.cjs'));
engines.capture = async (exe, args) => ({ code: 0, stderr: '', stdout: args[0] === '--version'
  ? /claude/.test(exe) ? '2.1.319 (Claude Code)' : 'codex-cli 0.0.0' : args[0] === 'auth' ? '{"loggedIn":true}' : 'Logged in using ChatGPT' });
engines.inspectClaude = async () => ({ models: [] });
engines.CodexEngine = class { async initialize() {} async shutdown() {} close() {}
  async request(method) { if (method === 'thread/list') return { data: [] }; if (method === 'config/read') return { config: {} }; throw Error('No model operation expected: ' + method); }
  async run() { result.modelCalls++; throw Error('Unexpected model call'); } };
engines.runClaude = () => { result.modelCalls++; throw Error('Unexpected Claude call'); };
const sharedWindows = [{ id: 'window:12:0', name: 'Fixture first' }, { id: 'window:13:0', name: 'Fixture second' }];
desktopCapturer.getSources = async () => sharedWindows.map(w => ({ ...w, thumbnail: nativeImage.createFromPath(path.join(appDir, 'notification-icon.png')) }));
require(path.join(appDir, 'computer-use.cjs')).windowsUi = async () => ({ identity: '123/456', application: 'fixture', controls: [] });
let media;
const voice = require(path.join(appDir, 'voice.cjs'));
voice.voiceAvailable = () => true;
voice.transcribe = (_value, _language, signal) => new Promise(resolve => {
  result.mediaCalls++; media = { resolve, signal }; signal.addEventListener('abort', () => result.aborted++, { once: true });
});
voice.speak = (_value, signal) => voice.transcribe(null, null, signal);
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (key, fn) => handle(key, (...args) => key === 'deck:quota-summary' ? null : fn(...args));
app.once('browser-window-created', (_, win) => {
  // Control visibility without opening a microphone or manipulating a real user's windows.
  let minimized = false;
  win.isVisible = () => true; win.isMinimized = () => minimized;
  win.webContents.once('did-finish-load', async () => {
    const js = code => win.webContents.executeJavaScript(code, true);
    const api = (key, payload) => js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(payload) ?? ''})`);
    const wait = async (fn, label) => { const end = Date.now() + 15000; while (Date.now() < end) { if (await fn()) return; await delay(20); } throw Error('Timeout: ' + label); };
    async function start(kind = 'voice-transcribe') {
      media = null;
      const id = randomUUID();
      const state = await api('state'), taskId = state.workspace.taskId;
      if (kind === 'voice-transcribe') await api('voice-arm', { id, taskId });
      await js(`window.__phase9Media = null; void window.aiDeck[${JSON.stringify(kind)}](${JSON.stringify({ id, taskId, language: 'en', audio: [], text: 'fixture' })}).then(value => window.__phase9Media={value}, error => window.__phase9Media={error:error.message}); true`);
      await wait(() => Boolean(media), 'media start'); return id;
    }
    async function cancelled(name) {
      assert.equal(media.signal.aborted, true, name);
      media.resolve('OLD_CHAT_TRANSCRIPT');
      await wait(() => js('Boolean(window.__phase9Media)'), 'media settlement');
      const value = await js('window.__phase9Media'); assert.ok(value.error, name); assert.equal(value.value, undefined);
      result.cases.push(name);
    }
    try {
      await wait(() => js(`Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')`), 'startup');
      // Removing the most recently previewed window must still allow sharing
      // the remaining earlier preview, without re-capturing or a model call.
      for (const remaining of [1, 2]) {
        await api('capture-windows');
        const first = await api('preview-computer-window', sharedWindows[0].id);
        const second = await api('preview-computer-window', sharedWindows[1].id);
        const grant = await api('computer-arm', { token: remaining === 1 ? [first.token] : [first.token, second.token], agent: 'codex' });
        assert.ok(grant.title.includes('Fixture first'));
        assert.equal(grant.title.includes('Fixture second'), remaining === 2);
        await api('computer-revoke', grant.token);
      }
      result.windowShares = 2;
      await start(); await api('switch-task', { repo: repos[0], id: b.id }); await cancelled('task switch discards old transcription');
      await api('switch-task', { repo: repos[0], id: a.id }); await start();
      await api('switch-task', { repo: repos[1], id: a.id }); await cancelled('same task ID in another project does not inherit voice');
      await start('voice-speak'); minimized = true; win.emit('minimize'); await cancelled('minimize cancels speech preparation');
      await assert.rejects(api('voice-arm', { id: randomUUID(), taskId: a.id }), /current task/); minimized = false;
      const id = await start(); await api('voice-cancel', { id }); await cancelled('explicit cancel preserves the composer');
      const state = await api('state'); assert.equal(state.jobs.length, 0); assert.equal(result.modelCalls, 0);
      assert.equal(state.workspace.runHistory.length, 0); assert.equal(result.aborted, 4);
      result.passed = true;
    } catch (error) { result.error = error.stack; }
    finally { fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2)); app.quit(); }
  });
});
const main = path.join(appDir, 'main.cjs'), boot = new Module(main, module); boot.filename = main; boot.paths = Module._nodeModulePaths(appDir);
boot._compile(fs.readFileSync(main, 'utf8').replace('width: 1240, height: 800', 'show: false, width: 1240, height: 800')
  .replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation', 'offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation')
  .replace('read: createUpdateReader({ capture,', 'read: async () => [], unusedReader: createUpdateReader({ capture,'), main);
