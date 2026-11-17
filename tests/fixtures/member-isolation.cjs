// Real desktop/Git/checks; only native model transports and local metadata are controlled.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto'), { execFileSync, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises'), { app, ipcMain } = require('electron');
app.disableHardwareAcceleration();
const root = process.env.AI_DECK_QA_ROOT, appDir = process.env.AI_DECK_QA_APP;
const profile = process.env.AI_DECK_PROFILE_DIRECTORY = path.join(root, 'profile'), repo = path.join(root, 'project');
process.env.CODEX_HOME = path.join(root, 'codex'); process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
for (const folder of [profile, repo, process.env.CODEX_HOME, process.env.CLAUDE_CONFIG_DIR]) fs.mkdirSync(folder, { recursive: true });
for (const name of ['uncaughtException', 'unhandledRejection']) process.on(name, error => { fs.writeFileSync(path.join(root, 'boot-error.txt'), String(error?.stack ?? error)); app.exit(1); });
const git = args => execFileSync('git', ['-c', 'core.hooksPath=NUL', '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', ...args], { cwd: repo, windowsHide: true });
git(['init', '-q', '-b', 'main']);
fs.writeFileSync(path.join(repo, 'source.js'), 'module.exports=1;\n');
fs.writeFileSync(path.join(repo, 'build.test.cjs'), "require('node:assert/strict').equal(require('./source.js'),1);\n");
fs.writeFileSync(path.join(repo, 'failing.test.cjs'), "require('node:assert/strict').equal(1,2,'intentional QA failure');\n");
git(['add', '.']); git(['commit', '-qm', 'fixture']);
const base = { codex: { model: 'gpt-fixture', effort: 'high', speed: 'standard' }, claude: { model: 'sonnet', effort: 'low', speed: 'standard' } };
const tasks = ['codex', 'claude'].map((writer, index) => {
  const task = require(path.join(appDir, 'tasks.cjs')).newTask();
  task.title = 'Concurrent member ' + index; task.agentModels = structuredClone(base);
  return { task, index, writer, held: false, sessions: [], settings: structuredClone(base), round: 1 };
});
const executables = {};
for (const provider of ['codex', 'claude']) { executables[provider] = path.join(root, provider + '.exe'); fs.writeFileSync(executables[provider], 'fixture'); }
fs.writeFileSync(path.join(profile, 'workspace-state.json'), JSON.stringify({ executables, currentRepo: repo, lowMemory: false, closeToTray: false, preferences: { notifications: 'off' },
  workspaces: { [repo]: { repo, tasks: tasks.map(entry => entry.task), currentTask: tasks[0].task.id, notes: [], plugins: [], instructions: '', shareNewFiles: true } } }));
const result = { calls: [], switches: [], checks: [] }; let api;
const wait = async (fn, label) => { const end = Date.now() + 20000; while (Date.now() < end) { if (await fn()) return; await delay(25); } throw Error('Timeout ' + label); };
const savedWorkspace = () => JSON.parse(fs.readFileSync(path.join(profile, 'workspace-state.json'))).workspaces[repo];
const engines = require(path.join(appDir, 'engines.cjs')), capture = engines.capture;
engines.capture = (exe, args, options) => /^git(?:\.exe)?$/iu.test(path.basename(exe)) ? capture(exe, args, options) : Promise.resolve({ code: 0, stderr: '',
  stdout: args[0] === '--version' ? /claude/.test(exe) ? '2.1.319 (Claude Code)' : 'codex-cli 0.0.0' : args[0] === 'auth' ? '{"loggedIn":true}' : 'Logged in using ChatGPT' });
engines.inspectClaude = async () => ({ models: [{ value: 'sonnet', supportsEffort: true, supportedEffortLevels: ['low', 'high'] }] });
async function turn(provider, id, cwd, prompt, readOnly, emit, options) {
  try {
  const entry = tasks.find(entry => prompt.includes('QA_MEMBER_' + entry.index)); assert.ok(entry, 'Exact task scope');
  for (const field of ['model', 'effort', 'speed']) assert.equal(options[field], entry.settings[provider][field], field + ' task ' + entry.index);
  assert.ok(prompt.includes('Member-specific verification guide'));
  result.calls.push({ task: entry.index, round: entry.round, provider, id, readOnly, settings: { model: options.model, effort: options.effort, speed: options.speed } });
  emit({ type: 'provider-call' });
  if (!readOnly) {
    entry.sessions.push(id);
    if (entry.round === 1) await new Promise(resolve => { entry.release = resolve; entry.held = true; });
    fs.appendFileSync(path.join(cwd, 'source.js'), '// task ' + entry.index + ' round ' + entry.round + '\n');
    for (const file of entry.index === 0 && entry.round === 1 ? ['failing.test.cjs', 'build.test.cjs'] : ['build.test.cjs']) {
      const key = randomUUID(), command = 'node --test ' + file;
      emit({ type: 'command-start', key, command });
      const checkEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }; delete checkEnv.NODE_TEST_CONTEXT;
      const check = spawnSync(process.execPath, ['--test', file], { cwd, windowsHide: true, encoding: 'utf8', env: checkEnv });
      assert.equal(check.status, file === 'failing.test.cjs' ? 1 : 0, check.stderr);
      assert.match(check.stdout, /(?:tests 1|test[s]?: 1)/); assert.doesNotMatch(check.stderr, /recursively/);
      emit({ type: 'command-result', key, command, exitCode: check.status, status: check.status ? 'failed' : 'completed', output: check.stdout });
      await wait(async () => (await api('state')).workspace.runHistory.at(-1)?.evidence?.some(e => e.id === key && e.checkout?.stamp), 'captured check ' + key);
      result.checks.push({ task: entry.index, round: entry.round, file, exitCode: check.status });
    }
    // The compact saved activity ring must not become the source of scoring truth.
    if (entry.index === 0 && entry.round === 1) for (let i = 0; i < 65; i++) emit({ type: 'command-result', key: randomUUID(), command: 'git status --short', exitCode: 0, status: 'completed' });
  }
  const text = readOnly ? 'AI_DECK_REVIEW: PASS\nR1 PASS — The source change is in scope; inspect the actual observed checks.' : 'Updated source.js and ran the checks for QA_MEMBER_' + entry.index + '.';
  emit({ type: 'message', key: randomUUID(), text }); return { status: 'completed', answer: text, sessionId: id };
  } catch (error) { (result.turnErrors ??= []).push(error.stack); throw error; }
}
engines.CodexEngine = class {
  constructor(_exe, cwd, _plugins, emit) { this.emit = emit; } async initialize() {} async shutdown() {} close() {} async interrupt() {}
  async request(method, payload) {
    if (method === 'thread/list') return { data: [] }; if (method === 'config/read') return { config: {} };
    if (method === 'model/list') return { data: ['gpt-fixture', 'gpt-other'].map(model => ({ model, displayName: model, serviceTiers: [{ id: 'priority' }], supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] })) };
    if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: payload.threadId ?? randomUUID() }, model: payload.model };
    if (method === 'thread/name/set') return {}; throw Error(method);
  }
  async run(id, cwd, prompt, readOnly, options) { return turn('codex', id, cwd, prompt, readOnly, this.emit, options); }
};
engines.runClaude = (_exe, cwd, prompt, _plugins, id, emit, options) => ({ done: turn('claude', id ?? randomUUID(), cwd, prompt, options.role !== 'write', emit, options), canSteer() { return false; }, close() {}, async stop() {} });
const handle = ipcMain.handle.bind(ipcMain); ipcMain.handle = (key, fn) => handle(key, (...args) => key === 'deck:quota-summary' ? null : fn(...args));
app.once('browser-window-created', (_, win) => win.webContents.once('did-finish-load', async () => {
  const js = code => win.webContents.executeJavaScript(code, true);
  api = (key, value) => js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(value) ?? ''})`);
  const open = entry => api('switch-task', { repo, id: entry.task.id });
  const payload = entry => ({ repo, taskId: entry.task.id, mode: entry.writer === 'codex' ? 'build-review' : 'claude-build-review', messageIntent: 'edit',
    prompt: 'QA_MEMBER_' + entry.index + ' Edit source.js in scope. R1: Preserve existing behavior and verify it.', teamOptions: { turnLimit: 2 } });
  try {
    await wait(() => js(`Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')`), 'startup');
    for (const entry of tasks) { await open(entry); await api('run', payload(entry)); await wait(() => entry.held, 'held ' + entry.index); }
    assert.equal((await api('state')).jobs.filter(job => job.state !== 'waiting').length, 2, 'Both tasks overlap');
    assert.equal(result.calls.length, 2);
    await assert.rejects(api('run', payload(tasks[1])), /already|running|busy/i); assert.equal(result.calls.length, 2);
    for (let i = 0; i < 8; i++) for (const entry of tasks) {
      const start = performance.now(); await open(entry); result.switches.push(performance.now() - start);
      const state = await api('state'); assert.deepEqual(state.workspace.agentModels, entry.settings);
      await api('save-draft', { ...payload(entry), prompt: 'Unsent member draft ' + entry.index });
    }
    tasks[1].release(); await wait(async () => !(await api('state')).jobs.some(job => job.taskId === tasks[1].task.id), 'Claude peer finished');
    // Read evidence for task 0 while its checks are captured.
    await open(tasks[0]); tasks[0].release(); await wait(async () => !(await api('state')).jobs.length, 'both saved');
    const first = savedWorkspace(); assert.equal(first.memberLearning.rows.length, 2);
    assert.deepEqual(first.memberLearning.rows.find(row => row.identity.provider === 'codex').skills.tests, { passed: 0, failed: 1 });
    assert.deepEqual(first.memberLearning.rows.find(row => row.identity.provider === 'claude').skills.tests, { passed: 1, failed: 0 });
    for (const entry of tasks) assert.equal(first.tasks.find(task => task.id === entry.task.id).savedDraft.prompt, 'Unsent member draft ' + entry.index);
    await api('provider-models', { agent: 'codex' });
    tasks[0].settings.codex = { model: 'gpt-other', effort: 'low', speed: 'fast' };
    await api('save-agent-settings', { agent: 'codex', scope: 'task', repo, taskId: tasks[0].task.id, options: tasks[0].settings.codex });
    for (const entry of tasks) { entry.round = 2; await open(entry); await api('run', payload(entry)); await wait(async () => !(await api('state')).jobs.length, 'second turn ' + entry.index); }
    const final = savedWorkspace(); assert.equal(final.memberLearning.rows.length, 3);
    assert.equal(final.memberLearning.rows.find(row => row.identity.model === 'gpt-other').skills.tests.passed, 1);
    assert.equal(final.memberLearning.rows.find(row => row.identity.provider === 'claude').skills.tests.passed, 2);
    for (const entry of tasks) { assert.equal(entry.sessions.length, 2); assert.equal(entry.sessions[0], entry.sessions[1]); }
    assert.equal(result.calls.length, 8); result.passed = true;
  } catch (error) { result.error = error.stack; } finally { fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2)); app.quit(); }
}));
const main = path.join(appDir, 'main.cjs'), boot = new Module(main, module); boot.filename = main; boot.paths = Module._nodeModulePaths(appDir);
boot._compile(fs.readFileSync(main, 'utf8').replace('width: 1240, height: 800', 'show: false, width: 1240, height: 800')
  .replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation', 'offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation')
  .replace('read: createUpdateReader({ capture,', 'read: async () => [], unusedReader: createUpdateReader({ capture,'), main);
