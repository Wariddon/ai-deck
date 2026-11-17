// Production renderer/main/preload with isolated profiles, real Git and controlled providers.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), { execFileSync } = require('node:child_process');
const { app, ipcMain, nativeImage } = require('electron'), { setTimeout: delay } = require('node:timers/promises');
app.disableHardwareAcceleration();
const root = process.env.AI_DECK_QA_ROOT, appDir = process.env.AI_DECK_QA_APP;
const restoring = process.env.AI_DECK_QA_RESTORE === '1';
process.on('uncaughtException', error => { fs.writeFileSync(path.join(root, 'boot-error.txt'), error.stack); app.exit(1); });
process.on('unhandledRejection', error => { fs.writeFileSync(path.join(root, 'boot-error.txt'), String(error?.stack || error)); app.exit(1); });
const profile = process.env.AI_DECK_PROFILE_DIRECTORY = path.join(root, 'profile'), repo = path.join(root, 'project');
process.env.CODEX_HOME = path.join(root, 'codex'); process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
for (const folder of [profile, repo, process.env.CODEX_HOME, process.env.CLAUDE_CONFIG_DIR]) fs.mkdirSync(folder, { recursive: true });
if (!restoring) {
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=NUL', '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', ...args], { cwd: repo, windowsHide: true });
  git(['init', '-q', '-b', 'main']); fs.writeFileSync(path.join(repo, 'sample.js'), 'export const value = 1;'); git(['add', '.']); git(['commit', '-qm', 'fixture']);
  const task = require(path.join(appDir, 'tasks.cjs')).newTask(); task.title = 'Release verification';
  const executables = {};
  for (const provider of ['codex', 'claude']) { executables[provider] = path.join(root, provider + '.exe'); fs.writeFileSync(executables[provider], 'fixture'); }
  fs.writeFileSync(path.join(profile, 'workspace-state.json'), JSON.stringify({ executables, currentRepo: repo, lowMemory: false, closeToTray: false,
    preferences: { notifications: 'off' }, workspaces: { [repo]: { repo, tasks: [task], currentTask: task.id, notes: [], plugins: [], instructions: '' } } }));
}
const result = { version: require(path.join(appDir, 'package.json')).version, restoring, sections: [], checks: [], modelCalls: 0, quitCalls: 0 };
const engines = require(path.join(appDir, 'engines.cjs')), capture = engines.capture;
engines.capture = (exe, args, options) => /^git(?:\.exe)?$/iu.test(path.basename(exe)) ? capture(exe, args, options)
  : Promise.resolve({ code: 0, stderr: '', stdout: args[0] === '--version' ? /claude/.test(exe) ? '2.1.319 (Claude Code)' : 'codex-cli 0.0.0'
    : args[0] === 'auth' ? '{"loggedIn":true}' : 'Logged in using ChatGPT' });
engines.inspectClaude = async () => ({ models: [{ value: 'sonnet', supportsEffort: true, supportedEffortLevels: ['low', 'high'] }] });
engines.CodexEngine = class {
  async initialize() {} async shutdown() {} close() {}
  async request(method) {
    if (method === 'config/read') return { config: {} };
    if (method === 'thread/list') return { data: [] };
    if (method === 'model/list') return { data: [{ model: 'gpt-fixture', displayName: 'QA GPT', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }] };
    throw Error('Unexpected provider operation ' + method);
  }
  async run() { result.modelCalls++; throw Error('No model call expected'); }
};
engines.runClaude = () => { result.modelCalls++; throw Error('No Claude call expected'); };
let failWrites = false;
const rename = fs.renameSync;
fs.renameSync = (source, destination) => {
  if (failWrites && path.resolve(destination).startsWith(profile + path.sep)) throw Object.assign(Error('QA disk unavailable'), { code: 'EACCES' });
  return rename(source, destination);
};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (key, fn) => handle(key, (...args) => key === 'deck:quota-summary' ? null : key === 'deck:quit-app' ? (result.quitCalls++, undefined) : fn(...args));
app.once('browser-window-created', (_, win) => win.webContents.once('did-finish-load', async () => {
  const js = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { throw Error(error.message + '\nOperation: ' + code.slice(0,500)); }
  };
  const api = (key, value) => js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(value) ?? ''})`);
  const wait = async (fn, label) => { const end = Date.now() + 12000; while (Date.now() < end) { if (await fn()) return; await delay(20); } throw Error('Timeout: ' + label); };
  const button = text => js(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.checkVisibility()&&e.textContent.trim()===${JSON.stringify(text)});if(!e||e.disabled)return false;e.click();return true})()`);
  const type = (selector, text) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const settings = async () => { await js(`document.querySelector('button[title="Settings"]').click()`); await wait(() => js(`!!document.querySelector('.deck-settings-sidebar')?.checkVisibility()`), 'Settings'); };
  try {
    await wait(() => js(`Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')`), 'startup');
    if (restoring) {
      await wait(() => js(`document.querySelector('[aria-label="Task message"]')?.value==='PHASE10_UNSENT_TEXT'`), 'restored draft');
      const state = await api('state'); assert.equal(state.workspace.agentModels.codex.model, 'gpt-fixture');
      assert.equal(state.workspace.agentModels.codex.effort, 'high'); assert.equal(state.workspace.agentModels.codex.speed, 'standard');
      assert.equal(state.workspace.recoveryDraft.draft.images.length, 1);
      result.checks.push('Unsent text, real image reference and Model/Effort/Speed survive program-version changes without dispatch');
    } else {
      await type('[aria-label="Task message"]', 'PHASE10_UNSENT_TEXT');
      const image = nativeImage.createFromBitmap(Buffer.alloc(16, 127), { width: 2, height: 2 }).toPNG().toString('base64');
      await js(`(()=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob(${JSON.stringify(image)}),c=>c.charCodeAt(0))],'qa.png',{type:'image/png'}));document.querySelector('form.thread-composer').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:d}));})()`);
      await wait(() => js(`document.querySelectorAll('.thread-composer [data-attachment-id]').length===1`), 'image thumbnail');
      const state = await api('state');
      await api('save-agent-settings', { agent: 'codex', scope: 'task', repo, taskId: state.workspace.taskId, options: { model: 'gpt-fixture', effort: 'high', speed: 'standard' } });
      await settings();
      const labels = await js(`[...document.querySelectorAll('.deck-settings-group button')].map(e=>e.textContent.trim())`);
      assert.equal(labels.length, 13); assert.equal(new Set(labels).size, 13);
      for (const label of labels) {
        const began = Date.now();
        await js(`[...document.querySelectorAll('.deck-settings-group button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`);
        await wait(() => js(`document.querySelector('.deck-settings-content>h2')?.textContent===${JSON.stringify(label)}`), label);
        const sample = await js(`(()=>{const e=document.querySelector('.deck-settings-content');return {text:e.innerText,selected:document.querySelectorAll('.deck-settings-group [aria-current="page"]').length,overflow:document.documentElement.scrollWidth>innerWidth+1}})()`);
        assert.equal(sample.selected, 1); assert.ok(sample.text.length > label.length); assert.equal(sample.overflow, false, label);
        result.sections.push({ label, ms: Date.now() - began });
      }
      for (const [width, height] of [[1240, 800], [760, 540]]) {
        win.setSize(width, height); await delay(120);
        assert.equal(await js(`document.documentElement.scrollWidth>innerWidth+1`), false, 'Settings horizontal overflow');
        fs.writeFileSync(path.join(root, `settings-${width}.png`), (await win.webContents.capturePage()).toPNG());
      }
      win.setSize(1240, 800);
      await type('[aria-label="Search settings"]', 'ไม่มีผลลัพธ์');
      await wait(() => js(`document.querySelector('.deck-settings-sidebar').innerText.includes('No settings match')`), 'empty search');
      await type('[aria-label="Search settings"]', ''); await button('General');
      const before = await api('state'), disk = fs.readFileSync(path.join(profile, 'workspace-state.json'), 'utf8'); failWrites = true;
      for (const [key, value] of [['save-appearance', { uiScale: 110, textScale: 100 }], ['save-panel-width', { side: 'projects', width: 300 }],
        ['save-low-memory', true], ['save-deck-preference', { key: 'theme', value: 'light' }],
        ['save-agent-settings', { agent: 'codex', scope: 'task', repo, taskId: before.workspace.taskId, options: { model: 'gpt-fixture', effort: 'low' } }]]) {
        await assert.rejects(api(key, value), /QA disk unavailable/);
      }
      const after = await api('state');
      for (const key of ['appearance', 'panelWidths', 'lowMemory', 'preferences']) assert.deepEqual(after[key], before[key]);
      assert.deepEqual(after.workspace.agentModels, before.workspace.agentModels); assert.equal(fs.readFileSync(path.join(profile, 'workspace-state.json'), 'utf8'), disk);
      result.checks.push('Five failed settings writes preserve on-disk and in-memory values');
      await js(`document.querySelector('.deck-nav button[title="Workspace"]').click()`);
      await wait(() => js(`!!document.querySelector('[aria-label="Task message"]')`), 'workspace draft');
      await type('[aria-label="Task message"]', 'UNSAVED_WHILE_DISK_FAILED');
      await delay(30); await settings(); await button('General'); await button('Quit AI Deck'); await delay(120);
      assert.equal(result.quitCalls, 0); assert.equal(win.isDestroyed(), false);
      assert.ok(await js(`document.body.innerText.includes('AI Deck stayed open')`));
      failWrites = false;
      await js(`document.querySelector('.deck-nav button[title="Workspace"]').click()`);
      await wait(() => js(`!!document.querySelector('[aria-label="Task message"]')`), 'retry workspace draft');
      await type('[aria-label="Task message"]', 'PHASE10_UNSENT_TEXT'); await delay(30); await settings(); await button('General'); await button('Quit AI Deck');
      await wait(() => result.quitCalls === 1, 'successful quit checkpoint');
      assert.equal((await api('state')).workspace.recoveryDraft.draft.prompt, 'PHASE10_UNSENT_TEXT');
      result.checks.push('General Quit holds a failed task checkpoint and succeeds after retry without losing the image');
    }
    assert.equal(result.modelCalls, 0); assert.equal((await api('state')).jobs.length, 0); result.passed = true;
  } catch (error) { result.error = error.stack; }
  finally { failWrites = false; fs.writeFileSync(path.join(root, restoring ? `restore-${result.version}.json` : 'result.json'), JSON.stringify(result, null, 2)); app.quit(); }
}));
const main = path.join(appDir, 'main.cjs'), boot = new Module(main, module); boot.filename = main; boot.paths = Module._nodeModulePaths(appDir);
boot._compile(fs.readFileSync(main, 'utf8').replace('width: 1240, height: 800', 'show: false, width: 1240, height: 800')
  .replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation', 'offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation')
  .replace('read: createUpdateReader({ capture,', 'read: async () => [], unusedReader: createUpdateReader({ capture,'), main);
