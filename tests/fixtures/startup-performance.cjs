const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto'), { setTimeout: delay } = require('node:timers/promises');
const { app, ipcMain } = require('electron');
app.disableHardwareAcceleration(); delete process.env.NODE_TEST_CONTEXT;
const root = process.env.AI_DECK_QA_ROOT, appDir = process.env.AI_DECK_QA_APP, scenario = process.env.AI_DECK_QA_STARTUP_CASE ?? 'healthy';
const profile = process.env.AI_DECK_PROFILE_DIRECTORY = path.join(root, 'profile'), cwd = path.join(root, 'project');
const real = process.env.AI_DECK_QA_REAL_METADATA === '1';
if (!real) { process.env.CODEX_HOME = path.join(root, 'codex'); process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude'); }
for (const dir of [profile, cwd]) fs.mkdirSync(dir, { recursive: true });
const executables = real ? JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'AI Deck/workspace-state.json'))).executables : {};
if (!real) for (const provider of ['codex', 'claude']) { executables[provider] = path.join(root, 'fixture-' + provider + '.exe'); fs.writeFileSync(executables[provider], 'fixture'); }
const { newTask } = require(path.join(appDir, 'tasks.cjs')), task = newTask(); task.title = 'Startup QA';
fs.writeFileSync(path.join(profile, 'workspace-state.json'), JSON.stringify({ executables, currentRepo: cwd, closeToTray: false, lowMemory: scenario === 'low-memory',
  preferences: { notifications: 'off' }, workspaces: { [cwd]: { repo: cwd, chatOnly: true, tasks: [task], currentTask: task.id, plugins: [], notes: [], instructions: '' } } }));
const report = { scenario, realMetadata: real, modelCalls: 0, closes: 0, commands: [], requests: [], ipc: [], quotaIntervals: [] };
const save = () => fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
process.on('uncaughtException', error => { report.error = error.stack; save(); app.exit(1); });
const engines = require(path.join(appDir, 'engines.cjs')), RealCodex = engines.CodexEngine;
let stalled;
const stall = () => new Promise(resolve => { stalled = resolve; });
if (!real) {
  const claudeFolder = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'fixture'); fs.mkdirSync(claudeFolder, { recursive: true });
  const id = randomUUID(); fs.writeFileSync(path.join(claudeFolder, id + '.jsonl'), JSON.stringify({ sessionId: id, uuid: randomUUID(), type: 'user', cwd, message: { content: 'Startup fixture' } }) + '\n');
  engines.capture = async (exe, args) => {
    const provider = /claude/.test(exe) ? 'claude' : 'codex'; report.commands.push({ provider, operation: args.slice(0, 2) });
    if (scenario === 'auth-stalled' && provider === 'codex') return stall();
    await delay(30);
    return { code: 0, stderr: '', stdout: args[0] === '--version' ? provider === 'claude' ? '2.1.319 (Claude Code)' : 'codex-cli 0.0.0' : args[0] === 'auth' ? JSON.stringify({ loggedIn: true }) : 'Logged in using ChatGPT' };
  };
  engines.inspectClaude = async (_exe, _cwd, usage) => { const interval = { provider: 'claude', start: performance.now() }; if (usage) report.quotaIntervals.push(interval); await delay(100); interval.end = performance.now(); return { models: [] }; };
  engines.CodexEngine = class {
    async initialize() { if (scenario === 'history-stalled') return stall(); }
    close() { report.closes++; } async shutdown() {}
    async request(method) {
      report.requests.push(method);
      if (method === 'account/rateLimits/read') { const interval = { provider: 'codex', start: performance.now() }; report.quotaIntervals.push(interval); if (scenario === 'account-stalled') return stall(); await delay(100); interval.end = performance.now(); return {}; }
      if (method === 'thread/list') { await delay(80); return { data: [] }; }
      throw Error('Unexpected startup request: ' + method);
    }
    async run() { report.modelCalls++; throw Error('Startup must not call a model'); }
  };
} else {
  engines.CodexEngine = class extends RealCodex { async run() { report.modelCalls++; throw Error('Metadata audit cannot call a model'); } };
}
engines.runClaude = () => { report.modelCalls++; throw Error('Startup cannot send a Claude prompt'); };
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (key, fn) => handle(key, async (...args) => {
  const began = performance.now(); const result = await fn(...args);
  if (['deck:state', 'deck:connections', 'deck:startup-data'].includes(key)) report.ipc.push({ key, ms: Math.round(performance.now() - began) });
  if (key === 'deck:startup-data') report.startup = { timings: result.timings, timedOut: result.timedOut, recents: result.recents.sessions.length, deferred: result.recents.deferred ?? false };
  return result;
});
const started = performance.now();
app.once('browser-window-created', (_, win) => {
  // Exercise the active-window quota path without showing a QA window.
  win.isVisible = () => true;
  win.webContents.once('did-finish-load', async () => {
    report.rendererLoadedMs = Math.round(performance.now() - started);
    const js = code => win.webContents.executeJavaScript(code, true);
    try {
      const end = performance.now() + 17000;
      while (performance.now() < end && !await js("Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')")) await delay(25);
      assert.ok(await js("!document.querySelector('.deck-startup')"), 'Startup must finish while a metadata reader remains stalled');
      report.readyMs = Math.round(performance.now() - started);
      const state = await js('window.aiDeck.state()'); report.connections = Object.fromEntries(Object.entries(state.connections).map(([provider, connection]) => [provider, { status: connection.status, checkMs: connection.checkMs }]));
      if (!real) {
        assert.equal(state.connections.claude.status, 'ready');
        if (scenario === 'auth-stalled') assert.equal(state.connections.codex.status, 'unavailable');
        if (['history-stalled', 'account-stalled'].includes(scenario)) assert.equal(report.startup.timedOut, true);
      }
      assert.equal(report.modelCalls, 0); report.passed = true;
    } catch (error) { report.error = error.stack; report.ui = await js('document.body.innerText.slice(-1200)').catch(() => ''); }
    finally { stalled?.({ code: 0, stdout: 'late', stderr: '' }); save(); app.quit(); }
  });
});
const main = path.join(appDir, 'main.cjs'), boot = new Module(main, module); boot.filename = main; boot.paths = Module._nodeModulePaths(appDir);
boot._compile(fs.readFileSync(main, 'utf8').replace('width: 1240, height: 800', 'show: false, width: 1240, height: 800')
  .replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation', 'offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation')
  .replace('read: createUpdateReader({ capture,', 'read: async () => [], unusedReader: createUpdateReader({ capture,'), main);
