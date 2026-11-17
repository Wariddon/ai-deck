// Real renderer, preload and backend; every provider/terminal is a local fixture.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"), { setTimeout: delay } = require("node:timers/promises");
const { app, ipcMain } = require("electron"); app.disableHardwareAcceleration();
const root = process.env.AI_DECK_QA_ROOT, appDir = process.env.AI_DECK_QA_APP, phase = process.env.AI_DECK_QA_PHASE;
const restore = phase === "restore", profile = process.env.AI_DECK_PROFILE_DIRECTORY = path.join(root, "profile");
const performanceProbe = process.env.AI_DECK_QA_PERFORMANCE === "1";
const performanceTurns = Math.min(2000, Math.max(240, Number(process.env.AI_DECK_QA_HISTORY_TURNS) || 240));
if (performanceProbe) app.commandLine.appendSwitch('enable-precise-memory-info');
const pathRecovery = process.env.AI_DECK_QA_PATH_RECOVERY === "1";
const paginationProbe = process.env.AI_DECK_QA_PAGINATION === "1";
const phase2Probe = process.env.AI_DECK_QA_PHASE2 === "1";
const concurrencyProbe = process.env.AI_DECK_QA_CONCURRENCY === '1';
const cwd = path.join(root, "chat-folder"), codexFile = path.join(root, "codex.json"), idsFile = path.join(root, "ids.json");
const claudeRoot = process.env.CLAUDE_CONFIG_DIR = path.join(root, "claude"), claudeFolder = path.join(claudeRoot, "projects", "fixture");
process.env.CODEX_HOME = path.join(root, "codex");
for (const directory of [profile, cwd, claudeFolder]) fs.mkdirSync(directory, { recursive: true });
const ids = restore ? JSON.parse(fs.readFileSync(idsFile)) : { a: randomUUID(), b: randomUUID() };
const sessions = [{ key: "a", provider: "codex", id: ids.a, title: "Native alpha" },
  { key: "b", provider: "codex", id: ids.b, title: "Native beta" },
  { key: "c", provider: "claude", id: ids.a, title: "Native Claude" }]; // Same ID, different providers.
if (phase2Probe) for (const session of sessions) session.title = ids.titles?.[session.key] ?? session.title;
const claudeFile = path.join(claudeFolder, ids.a + ".jsonl");
const appendClaude = (type, text) => fs.appendFileSync(claudeFile, JSON.stringify({ uuid: randomUUID(), sessionId: ids.a,
  type, cwd, timestamp: new Date().toISOString(), message: { content: [{ type: "text", text }] } }) + "\n");
let turns;
if (!restore) {
  const { newTask } = require(path.join(appDir, "tasks.cjs"));
  const tasks = ["a", "b"].map(key => {
    const task = newTask(); task.title = "Team draft " + key; ids["task" + key] = task.id;
    task.agentModels = { codex: { model: key === "a" ? "gpt-fixture-a" : "gpt-fixture-b", effort: "high", speed: "standard" } };
    task.savedDraft = { mode: "team-discussion", prompt: "Unsent team draft " + key }; return task;
  });
  fs.writeFileSync(idsFile, JSON.stringify(ids));
  const executables = {};
  for (const provider of ["codex", "claude"]) { executables[provider] = path.join(root, "fixture-" + provider + ".exe"); fs.writeFileSync(executables[provider], "fixture"); }
  if (pathRecovery) { fs.writeFileSync(path.join(root, "defaults.json"), JSON.stringify({ claude: executables.claude })); delete executables.claude; }
  fs.writeFileSync(path.join(profile, "workspace-state.json"), JSON.stringify({ executables, currentRepo: cwd, lowMemory: false, closeToTray: false,
    workspaces: { [cwd]: { repo: cwd, chatOnly: true, tasks, currentTask: tasks[0].id, notes: [], plugins: [], instructions: "" } },
    agentSettings: { codex: { model: "wrong-global-model" }, claude: { model: "wrong-global-model" } }, preferences: { notifications: "off" } }));
  if (phase2Probe) {
    const filename = path.join(profile, 'workspace-state.json'), saved = JSON.parse(fs.readFileSync(filename));
    const other = newTask(), otherRepo = path.join(root, 'other-project'); fs.mkdirSync(otherRepo);
    other.title = 'Other project draft'; other.savedDraft = { mode: 'team-discussion', prompt: 'Keep other project' }; ids.other = other.id;
    saved.workspaces[otherRepo] = { repo: otherRepo, chatOnly: true, tasks: [other], currentTask: other.id, notes: [], plugins: [], instructions: '' };
    fs.writeFileSync(filename, JSON.stringify(saved)); fs.writeFileSync(idsFile, JSON.stringify(ids));
  }
  turns = Object.fromEntries([ids.a, ids.b].map(id => [id, [{ id: randomUUID(), status: "completed", items: [
    { type: "userMessage", id: randomUUID(), content: [{ type: "text", text: "Original question" }] },
    { type: "agentMessage", id: randomUUID(), text: "Original answer" },
  ] }]]));
  if (performanceProbe) turns[ids.a] = Array.from({ length: performanceTurns }, (_, index) => ({ id: randomUUID(), status: "completed", items: [
    { type: "userMessage", id: randomUUID(), content: [{ type: "text", text: "Long history fixture question " + index }] },
    { type: "agentMessage", id: randomUUID(), text: "Long history fixture reply " + index + "\n\n" +
      "- Keep the input API compatible.\n- Preserve the saved draft.\n\n```js\nconst output = await readValue(input);\n```\n\n| Check | Result |\n| --- | --- |\n| Input | Observed |" },
  ] }));
  if (paginationProbe) turns[ids.a] = Array.from({ length: 24 }, (_, index) => ({ id: randomUUID(), status: "completed", items: [
    { type: "userMessage", id: randomUUID(), content: [{ type: "text", text: "Page question " + index }] },
    { type: "agentMessage", id: randomUUID(), text: "Page reply " + index },
  ] }));
  fs.writeFileSync(codexFile, JSON.stringify(turns)); appendClaude("user", "Native Claude"); appendClaude("assistant", "Original Claude answer");
} else turns = JSON.parse(fs.readFileSync(codexFile));
const report = { phase, calls: [], checks: [], timings: [] }, active = new Set();
const turnGates = new Map(), activeGates = new Map();
const holdTurn = (provider, approval = false) => {
  let finish; const promise = new Promise(resolve => { finish = resolve; });
  const gate = { entered: false, approval, release() { finish(); }, stop() { gate.stopped = true; finish(); }, promise };
  turnGates.set(provider, gate); return gate;
};
function turnControl(provider, id, kind, key) {
  const gate = activeGates.get(provider + id); if (!gate) return false;
  (report.controls ??= []).push({ provider, id, kind, key });
  if (kind === 'stop') gate.stop();
  return true;
}
const save = () => fs.writeFileSync(path.join(root, phase + ".json"), JSON.stringify(report, null, 2));
process.on("uncaughtException", error => { report.error = error.stack; save(); app.exit(1); });
const engines = require(path.join(appDir, "engines.cjs"));
engines.capture = async (exe, args) => ({ code: 0, stderr: "", stdout: args[0] === "--version"
  ? /claude/u.test(exe) ? "2.1.319 (Claude Code)" : "codex-cli 0.0.0"
  : args[0] === "auth" ? JSON.stringify({ loggedIn: !pathRecovery }) : "Logged in using ChatGPT" });
engines.inspectClaude = async () => ({ models: [{ value: "sonnet", displayName: "Sonnet fixture", supportsEffort: true, supportedEffortLevels: ["low", "high"] }] });
function runner(provider, id, prompt, options, emit) {
  if (phase2Probe) prompt = require(path.join(appDir, 'task-images.cjs')).attachmentInput(prompt, options.images ?? []);
  report.calls.push({ provider, id, prompt, model: options.model, effort: options.effort, speed: options.speed, permissionMode: options.permissionMode, images: (options.images ?? []).map(row => row.id) }); active.add(provider + id);
  const turn = { id: randomUUID(), status: "inProgress", items: [{ type: "userMessage", id: randomUUID(), content: [{ type: "text", text: prompt }] }] };
  if (provider === "codex") (turns[id] ??= []).unshift(turn); else if (id === ids.a) appendClaude("user", prompt);
  const gate = turnGates.get(provider); turnGates.delete(provider);
  if (gate) { gate.entered = true; gate.id = id; activeGates.set(provider + id, gate); if (gate.approval) emit?.({ type: 'approval', key: 'same-approval', title: provider + ' scoped approval', text: 'Read this QA folder only.' }); }
  return (gate ? gate.promise : delay(140)).then(() => {
    active.delete(provider + id); turn.status = "completed";
    if (provider === "codex") { turn.items.push({ type: "agentMessage", id: randomUUID(), text: "Reply: " + prompt }); fs.writeFileSync(codexFile, JSON.stringify(turns)); }
    else if (id === ids.a) appendClaude("assistant", "Reply: " + prompt);
    activeGates.delete(provider + id); emit?.({ type: 'message', key: randomUUID(), text: 'Scoped fixture reply.' });
    return { status: gate?.stopped ? "interrupted" : "completed", sessionId: id, answer: 'Scoped fixture reply.' };
  });
}
engines.CodexEngine = class {
  constructor(_exe, _cwd, _plugins, emit) { this.emit = emit; } async initialize() {} async shutdown() {} close() {}
  async interrupt() { return turnControl('codex', this.id, 'stop'); }
  decide(key) { return turnControl('codex', this.id, 'approval', key); }
  async request(method, payload) {
    if (method === "thread/list") return { data: sessions.filter(s => s.provider === "codex" && Boolean(s.archived) === Boolean(payload.archived)).map(s => ({ id: s.id, name: s.title, cwd, updatedAt: 1000 })) };
    if (method === "thread/read") return { thread: { id: payload.threadId, cwd, status: { type: active.has("codex" + payload.threadId) ? "active" : "idle" }, updatedAt: 1000 } };
    if (method === "thread/turns/list") {
      if (!paginationProbe) return { data: turns[payload.threadId] };
      const offset = payload.cursor ? Number(payload.cursor.slice(5)) : 0;
      report.historyReads ??= []; report.historyReads.push({ id: payload.threadId, cursor: payload.cursor ?? null });
      const rows = turns[payload.threadId]; return { data: rows.slice(offset, offset + 8), nextCursor: offset + 8 < rows.length ? "page:" + (offset + 8) : null };
    }
    if (method === "config/read") return { config: {} };
    if (method === "model/list") return { data: ["a", "b"].map(key => ({ model: "gpt-fixture-" + key, displayName: "GPT " + key,
      supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }], serviceTiers: [{ id: "priority" }] })) };
    if (method === "thread/resume") return { thread: { id: payload.threadId }, model: payload.model };
    if (phase2Probe && method === 'thread/start') return { thread: { id: randomUUID() } };
    if (phase2Probe && method === 'thread/name/set') { const session = sessions.find(s => s.id === payload.threadId && s.provider === 'codex'); if (session) { session.title = payload.name; (ids.titles ??= {})[session.key] = payload.name; fs.writeFileSync(idsFile, JSON.stringify(ids)); } return {}; }
    if (phase2Probe && ['thread/archive','thread/unarchive'].includes(method)) { const session = sessions.find(s => s.id === payload.threadId && s.provider === 'codex'); session.archived = method === 'thread/archive'; return {}; }
    throw Error("Unexpected provider operation " + method);
  }
  async run(id, _cwd, prompt, _readOnly, options) { this.id = id; return runner("codex", id, prompt, options, this.emit); }
};
engines.runClaude = (_exe, _cwd, prompt, _plugins, id, emit, options) => {
  id ??= randomUUID(); options.onSessionId?.(id);
  return { done: runner("claude", id, prompt, options, emit), close() {}, async stop() { turnControl('claude', id, 'stop'); }, decide(key) { return turnControl('claude', id, 'approval', key); } };
};
let holdReply = false, replyFinished = false, releaseReply, holdSave = false, saveFinished = false, releaseSave, pendingSteps = false;
let replyGate, saveGate;
const phase2Gates = new Map();
const holdPhase2 = (key, matches) => {
  let release; const promise = new Promise(resolve => { release = resolve; });
  const gate = { entered: false, matches, release() { phase2Gates.delete(key); release(); }, promise };
  phase2Gates.set(key, gate); return gate;
};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (key, fn) => handle(key, async (...args) => {
  if (key === "deck:quota-summary") return null;
  const result = await fn(...args);
  if (process.env.AI_DECK_QA_INTERACTION_MATRIX === '1' && key === 'deck:preview-task-attachment') (report.previewReads ??= []).push({ id: args[1]?.id, thumbnail: args[1]?.thumbnail === true });
  const phase2Gate = phase2Gates.get(key);
  if (phase2Gate && (!phase2Gate.matches || phase2Gate.matches(args[1]))) { phase2Gate.entered = true; await phase2Gate.promise; }
  if (pendingSteps && key === "deck:native-session-preview" && args[1].id === ids.a) {
    result.chat = { ...result.chat, active: true, pending: { requestId: "performance-work", prompt: "Observed work fixture", events:
      Array.from({ length: 120 }, (_, index) => ({ type: "activity", text: "Detailed work step " + index + "\n" + "Recorded output. ".repeat(200) })) } };
  }
  if (key === "deck:native-chat-send" && holdReply && args[1].provider === "codex" && args[1].id === ids.a) { replyFinished = true; await replyGate; }
  if (key === "deck:save-native-chat-models" && holdSave) { saveFinished = true; await saveGate; }
  return result;
});
const wait = async (fn, label) => { const until = Date.now() + 15000; while (Date.now() < until) { if (await fn()) return; await delay(40); } throw Error("Timeout " + label); };
let seeded = restore || performanceProbe || pathRecovery || paginationProbe || concurrencyProbe, started = false;
app.once("browser-window-created", (_, win) => win.webContents.on("did-finish-load", async () => {
  const js = code => win.webContents.executeJavaScript(code, true);
  const api = (key, payload) => js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(payload) ?? ""})`);
  const click = label => js(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.checkVisibility()&&!e.disabled&&(e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)}));if(!e)return false;e.click();return true})()`);
  const type = (text, selector = ".deck-native-chat textarea") => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const open = async key => {
    const session = sessions.find(s => s.key === key), start = performance.now();
    await click("Recents"); await wait(() => click((session.provider === "codex" ? "Codex" : "Claude Code") + ": " + session.title), "open " + key);
    await wait(() => js(`Boolean(document.querySelector('.deck-native-chat textarea'))&&/Replies are saved${phase2Probe || concurrencyProbe ? '|Sending to' : ''}/.test(document.querySelector('.deck-native-chat .thread-hint')?.textContent??'')`), "chat ready " + key);
    const openMs = Math.round(performance.now() - start);
    if (performanceProbe) await wait(() => js("Boolean([...document.querySelectorAll('.deck-native-reply')].at(-1)?.querySelector('.deck-markdown'))||!document.querySelector('.deck-native-reply')"), 'latest reply formatted');
    report.timings.push({ key, openMs, ...(performanceProbe && { latestReplyMs: Math.round(performance.now() - start) }) });
  };
  const select = async (label, value) => {
    assert.equal(await js(`(()=>{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');if(!e||e.disabled)return false;e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`), true, label); await delay(30);
  };
  const picker = async key => { await wait(() => click((key === "c" ? "Claude Code" : "Codex") + " model, effort and speed"), "model picker");
    await wait(() => js("Boolean(document.querySelector('.deck-native-model-panel:popover-open select'))&&!document.querySelector('.deck-native-model-panel:popover-open select').disabled"), "catalog"); };
  const options = { a: { model: "gpt-fixture-a", effort: "low", speed: "standard" }, b: { model: "gpt-fixture-b", effort: "high", speed: "fast" }, c: { model: "sonnet", effort: "low", speed: "standard" } };
  const saveOptions = async key => { for (const field of ["model", "effort", "speed"]) await select("Original chat " + field, options[key][field]); assert.equal(await click("Save"), true); };
  const assertOptions = async key => {
    await picker(key);
    for (const field of ["model", "effort", "speed"]) assert.equal(await js(`document.querySelector('select[aria-label="Original chat ${field}"]').value`), options[key][field], key + " " + field);
    await js("document.querySelector('.deck-native-model-panel:popover-open').hidePopover()");
  };
  const draft = () => js("document.querySelector('.deck-native-chat textarea').value");
  if (!seeded) {
    seeded = true;
    await js(`localStorage.setItem('ai-deck-native-drafts',JSON.stringify(Array.from({length:20},(_,i)=>[JSON.stringify(['codex','','legacy-'+i]),'Unsent legacy '+i])))`);
    win.webContents.reload(); return;
  }
  if (started) return; started = true;
  try {
    await wait(() => js("Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')"), "startup");
    if (concurrencyProbe) {
      await require('./concurrency-scenarios.cjs')({ report, js, api, click, type, open, draft, wait, holdTurn, ids });
      report.passed = true; save(); app.quit(); return;
    }
    if (phase2Probe) {
      await require('./phase2-scenarios.cjs')({ restore, root, profile, cwd, ids, sessions, report, save, win, js, api, click, type, open, picker, saveOptions, assertOptions, options, draft, wait, hold: holdPhase2, holdTurn });
      report.passed = true; save(); app.quit(); return;
    }
    await api("pull-native-recents");
    if (paginationProbe) {
      await open("a");
      const count = () => js("document.querySelectorAll('.deck-native-reply,.deck-native-turn').length");
      assert.equal(await count(), 16); await type("Keep pagination draft");
      assert.equal(await click("Load older messages"), true);
      await wait(async () => await count() === 32, "first older page");
      assert.equal(await click("Refresh messages"), true);
      await wait(() => js("!document.querySelector('button[aria-label=\"Refresh messages\"]').disabled"), "history refreshed");
      assert.equal(await count(), 32, "Refreshing must keep loaded older messages");
      assert.equal(await draft(), "Keep pagination draft");
      const before = report.historyReads.length;
      assert.equal(await click("Load older messages"), true);
      await wait(async () => await count() === 48, "next unvisited older page");
      assert.equal(report.historyReads[before].cursor, "page:16", "Refresh must not rewind the older-page cursor");
      await type("Page follow-up");
      await js("document.querySelector('.deck-native-chat form').requestSubmit();document.querySelector('.deck-native-chat form').requestSubmit()");
      await wait(async () => report.calls.length === 1 && !(await api("state")).jobs.length, "single paged-chat send");
      await wait(async () => await count() === 50, "reply retains all loaded history");
      assert.equal(await js("Boolean(document.querySelector('.deck-native-older'))"), false, "An exhausted cursor stays exhausted after delivery");
      await type("Keep after follow-up"); await open("b"); assert.equal(await draft(), "");
      await open("a"); assert.equal(await draft(), "Keep after follow-up");
      report.pagination = { first: 16, loaded: 48, afterRefresh: 32, afterSend: 50, calls: report.calls.length };
      report.passed = true; save(); app.quit(); return;
    }
    if (pathRecovery) {
      const expected = path.join(root, "fixture-claude.exe");
      const saved = JSON.parse(fs.readFileSync(path.join(profile, "workspace-state.json"), "utf8"));
      assert.equal(saved.executables.claude, expected, "A verified default must persist even while signed out");
      assert.equal((await api("state")).connections.claude.status, "signIn");
      assert.equal(report.calls.length, 0);
      if (!restore) fs.unlinkSync(path.join(root, "defaults.json"));
      report.pathRetained = true; report.passed = true; save(); app.quit(); return;
    }
    if (performanceProbe) {
      await open("a");
      await wait(() => js(`document.querySelectorAll('.deck-native-reply').length === ${performanceTurns}`), "long transcript");
      const measurements = await js(`(async()=>{
        const matches = array => array.length > 0 && ['user','assistant'].includes(array[0]?.role) && array[0]?.text?.startsWith('Long history fixture');
        const originals = { filter: Array.prototype.filter, map: Array.prototype.map }; let passes=0, items=0;
        for(const method of ['filter','map']) Array.prototype[method]=function(...args){if(matches(this)){passes++;items+=this.length;}return originals[method].apply(this,args)};
        const times=[]; const input=document.querySelector('.deck-native-chat textarea');
        try { for(let i=0;i<12;i++){const start=performance.now();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Performance draft '+i);input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));times.push(performance.now()-start);} }
        finally { for(const method of ['filter','map']) Array.prototype[method]=originals[method]; }
        return {messages:document.querySelectorAll('.deck-native-reply,.deck-native-turn').length,passes,items,times};
      })()`);
      report.performance = measurements;
      assert.equal(measurements.messages, performanceTurns * 2);
      if (process.env.AI_DECK_QA_ALLOW_HISTORY_REBUILD !== "1") assert.equal(measurements.passes, 0, "Typing must reuse the loaded transcript instead of walking old messages");
      assert.equal(await draft(), "Performance draft 11");
      const deferredCount = await js("document.querySelectorAll('[data-native-deferred]').length");
      report.historyRendering = { deferredCount, totalReplies: performanceTurns, scrollAndWrapPreserved: false };
      if (deferredCount) {
        assert.ok(deferredCount > performanceTurns - 60, 'Offscreen formatting must stay bounded');
        await wait(() => js("(()=>{const feed=document.querySelector('.deck-native-feed');return feed.scrollHeight-feed.scrollTop-feed.clientHeight<48})()"), 'latest reply stays in view');
        await js("(()=>{const feed=document.querySelector('.deck-native-feed');feed.scrollTop=0;feed.dispatchEvent(new Event('scroll'))})()");
        await wait(() => js("Boolean(document.querySelector('.deck-native-reply')?.querySelector('.deck-markdown'))"), 'oldest message formatted on scroll');
      }
      assert.equal(await js("(()=>{const block=document.querySelector('.deck-code-block');block.querySelector('button[aria-label=\"Disable word wrap\"]').click();return true})()"), true);
      await wait(() => js("document.querySelector('.deck-code-block').dataset.wrap === 'off'"), "code block remains interactive");
      if (deferredCount) {
        await js("window.fixtureWrappedBlock=document.querySelector('.deck-code-block');true");
        await js("(()=>{const feed=document.querySelector('.deck-native-feed');feed.scrollTop=feed.scrollHeight;feed.dispatchEvent(new Event('scroll'))})()");
        await delay(80);
        await js("(()=>{const feed=document.querySelector('.deck-native-feed');feed.scrollTop=0;feed.dispatchEvent(new Event('scroll'))})()");
        await delay(80);
        assert.equal(await js("document.contains(window.fixtureWrappedBlock)&&window.fixtureWrappedBlock.dataset.wrap"), 'off', 'Scrolling must not remount an already revealed code block');
        report.historyRendering.scrollAndWrapPreserved = true;
      }
      assert.equal(await click("Chat actions"), true); assert.equal(await click("Search in chat"), true);
      await js("(()=>{const input=document.querySelector('input[aria-label=\"Search in this chat\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'fixture reply 239');input.dispatchEvent(new Event('input',{bubbles:true}))})()");
      await wait(() => js("document.querySelectorAll('.deck-native-reply').length === 1"), "search updated transcript");
      assert.equal(await click("Close search"), true);
      await wait(() => js(`document.querySelectorAll('.deck-native-reply').length === ${performanceTurns}`), "restore full transcript");
      if (process.env.AI_DECK_QA_ALLOW_HISTORY_REBUILD !== "1") {
        pendingSteps = true; assert.equal(await click("Refresh messages"), true);
        await wait(() => js("Boolean(document.querySelector('.deck-native-work>summary'))"), "activity steps");
        assert.equal(await js("document.querySelectorAll('.deck-native-work pre').length"), 0, "Collapsed work does not mount every command output");
        await js("document.querySelector('.deck-native-work>summary').click()");
        await wait(() => js("document.querySelectorAll('.deck-native-work .thread-work-steps>details').length === 80"), "recent work summaries");
        assert.equal(await js("document.querySelectorAll('.deck-native-work pre').length"), 0);
        await js("document.querySelector('.deck-native-work .thread-work-steps>details>summary').click()");
        await wait(() => js("document.querySelector('.deck-native-work pre')?.textContent.startsWith('Detailed work step 40')"), "correct retained work detail");
        pendingSteps = false;
      }
      await open("b"); assert.equal(await draft(), "");
      await open("a"); assert.equal(await draft(), "Performance draft 11");
      if (process.env.AI_DECK_QA_INTERACTION_MATRIX === '1') {
        await require('./interaction-performance.cjs')({ root, report, js, api, click, type, open, picker, saveOptions, assertOptions, options, draft, wait, win });
        report.passed = true; save(); app.quit(); return;
      }
      const soakMs = Math.min(4 * 60 * 60_000, Math.max(0, Number(process.env.AI_DECK_QA_SOAK_MS) || 0));
      if (soakMs) {
        const expected = {}, samples = [], typing = [], switching = [], scrolling = [], menus = [], began = performance.now();
        let cycle = 0, lastSample = -Infinity;
        for (const key of ['a', 'b', 'c']) { await open(key); await picker(key); await saveOptions(key); expected[key] = 'Soak initial ' + key; await type(expected[key]); }
        const sample = () => ({ elapsedMs: Math.round(performance.now() - began), cycles: cycle,
          mainHeapMiB: process.memoryUsage().heapUsed / 1024 ** 2,
          processes: app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type,
            workingSetMiB: metric.memory.workingSetSize / 1024, cpuSeconds: metric.cpu.cumulativeCPUUsage, cpuPercent: metric.cpu.percentCPUUsage,
            ...(Number.isFinite(metric.memory.privateBytes) && { privateMiB: metric.memory.privateBytes / 1024 }) })) });
        while (performance.now() - began < soakMs) {
          const key = ['a', 'b', 'c'][cycle % 3], start = performance.now(); await open(key); switching.push(performance.now() - start);
          assert.equal(await draft(), expected[key], 'Soak restores only this native draft');
          expected[key] = 'Soak draft ' + key + ' ' + cycle;
          typing.push(await js(`(async()=>{const start=performance.now(),input=document.querySelector('.deck-native-chat textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(expected[key])});input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return performance.now()-start})()`));
          if (cycle % 90 === 0) { const start = performance.now(); await assertOptions(key); menus.push(performance.now() - start); }
          if (cycle % 30 === 0) scrolling.push(await js(`(async()=>{const start=performance.now(),feed=document.querySelector('.deck-native-feed');feed.scrollTop=0;feed.dispatchEvent(new Event('scroll'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));feed.scrollTop=feed.scrollHeight;feed.dispatchEvent(new Event('scroll'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start})()`));
          cycle++;
          if (performance.now() - began - lastSample > 15_000) {
            lastSample = performance.now() - began;
            samples.push({ ...sample(), rendererHeapMiB: await js('performance.memory?.usedJSHeapSize / 1024 ** 2 || null') });
            report.soak = { elapsedMs: Math.round(lastSample), cycles: cycle, samples }; save();
          }
          await delay(Math.min(5000, Math.max(150, Number(process.env.AI_DECK_QA_SOAK_INTERVAL_MS) || 150)));
        }
        for (const key of ['a', 'b', 'c']) { await open(key); assert.equal(await draft(), expected[key]); await assertOptions(key); }
        await open('a'); await delay(1200); samples.push({ ...sample(), rendererHeapMiB: await js('performance.memory?.usedJSHeapSize / 1024 ** 2 || null') });
        const p95 = rows => [...rows].sort((a,b)=>a-b)[Math.max(0,Math.ceil(rows.length*.95)-1)];
        report.soak = { elapsedMs: Math.round(performance.now()-began), cycles: cycle, messages: performanceTurns * 2,
          typingP95Ms: p95(typing), switchingP95Ms: p95(switching),
          scrollingP95Ms: p95(scrolling), menusP95Ms: p95(menus),
          budgets: { typingP95Ms: 100, switchingP95Ms: 1500, scrollingP95Ms: 250, menusP95Ms: 500 }, samples, modelCalls: report.calls.length, draftsAndModelsPreserved: true };
        assert.equal(report.calls.length,0); report.passed=true; save(); app.quit(); return;
      }
      assert.equal(report.calls.length, 0);
      report.passed = true; save(); app.quit(); return;
    }
    if (!restore) {
      for (const key of ["a", "b", "c"]) { await open(key); await picker(key); await saveOptions(key);
        await wait(() => js("!document.querySelector('.deck-native-model-panel:popover-open')"), "saved model"); await type("Unsent native " + key); }
      await open("a"); await assertOptions("a"); assert.equal(await draft(), "Unsent native a");
      await js(`window.fixtureDraftWrites=0;const setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='ai-deck-native-drafts')window.fixtureDraftWrites++;return setItem.call(this,key,value)};
        const input=document.querySelector('.deck-native-chat textarea');for(let i=0;i<60;i++){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Typing '+i);input.dispatchEvent(new Event('input',{bubbles:true}))}`);
      await wait(() => js("window.fixtureDraftWrites>0"), "batched draft persistence");
      report.burstWrites = await js("window.fixtureDraftWrites"); assert.equal(report.burstWrites, 1);
      replyGate = new Promise(resolve => { releaseReply = resolve; }); holdReply = true;
      await type("Same text in two chats");
      await js("document.querySelector('.deck-native-chat form').requestSubmit();document.querySelector('.deck-native-chat form').requestSubmit()");
      await open("b"); await type("Same text in two chats");
      await wait(() => replyFinished, "late reply"); releaseReply(); holdReply = false; await delay(150);
      assert.equal(await draft(), "Same text in two chats"); await assertOptions("b"); assert.equal(report.calls.length, 1);
      await open("a"); await type("Keep native a");
      saveGate = new Promise(resolve => { releaseSave = resolve; }); holdSave = true;
      await picker("a"); options.a = { model: "gpt-fixture-b", effort: "high", speed: "standard" }; await saveOptions("a");
      await wait(() => saveFinished, "late model save"); await open("b"); releaseSave(); holdSave = false; await delay(100);
      assert.equal(await draft(), "Same text in two chats"); await assertOptions("b");
      for (const key of ["b", "c"]) {
        await open(key); await assertOptions(key); await type("Send once " + key); const count = report.calls.length;
        await js("document.querySelector('.deck-native-chat form').requestSubmit();document.querySelector('.deck-native-chat form').requestSubmit()");
        await wait(async () => report.calls.length === count + 1 && !(await api("state")).jobs.length, "single send " + key);
        await wait(() => js("!document.querySelector('.deck-native-chat .thread-hint').textContent.includes('Sending to')"), "delivery " + key);
        await type("Keep native " + key);
      }
      assert.deepEqual(report.calls.map(call => [call.provider, call.id, call.model, call.effort, call.speed]), [
        ["codex", ids.a, "gpt-fixture-a", "low", "standard"], ["codex", ids.b, "gpt-fixture-b", "high", "fast"], ["claude", ids.a, "sonnet", "low", "standard"],
      ]);
      report.checks.push("late replies and saves keep the other chat's draft and settings", "duplicate submit calls each provider once");
    } else {
      options.a = { model: "gpt-fixture-b", effort: "high", speed: "standard" };
      for (const key of ["a", "b", "c"]) { await open(key); assert.equal(await draft(), "Keep native " + key); await assertOptions(key); }
      assert.equal(report.calls.length, 0);
      report.checks.push("all native selections and unsent drafts survive full restart without replay");
    }
    await click("Back to workspace");
    for (const key of ["a", "b"]) {
      if (!await click("Team draft " + key)) { await click("Projects"); await wait(() => click("Team draft " + key), "task " + key); }
      await wait(async () => (await api("state")).workspace?.taskId === ids["task" + key], "selected task " + key);
      assert.equal(await js("document.querySelector('.thread-composer textarea').value"), "Unsent team draft " + key);
      assert.equal((await api("state")).workspace.agentModels.codex.model, "gpt-fixture-" + key);
    }
    report.checks.push("task settings and drafts stay separate");
    const stored = await js("JSON.parse(localStorage.getItem('ai-deck-native-drafts'))");
    for (let i = 0; i < 20; i++) assert.equal(new Map(stored).get(JSON.stringify(["codex", "", "legacy-" + i])), "Unsent legacy " + i);
    report.legacyDrafts = 20; report.passed = true;
  } catch (error) { report.error = error.stack; report.ui = await js("document.body.innerText.slice(-2000)").catch(() => ""); }
  finally { save(); app.quit(); }
}));
const main = path.join(appDir, "main.cjs"), boot = new Module(main, module); boot.filename = main; boot.paths = Module._nodeModulePaths(appDir);
boot._compile(fs.readFileSync(main, "utf8").replace("width: 1240, height: 800", "show: false, width: 1240, height: 800")
  .replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation', 'offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation')
  .replace('path.join(__dirname, "local-defaults.json")', pathRecovery ? 'path.join(process.env.AI_DECK_QA_ROOT, "defaults.json")' : 'path.join(__dirname, "local-defaults.json")')
  .replace("read: createUpdateReader({ capture,", "read: async () => [], unusedReader: createUpdateReader({ capture,"), main);
