// Real renderer, preload and backend; every provider/terminal is a local fixture.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"), { setTimeout: delay } = require("node:timers/promises");
const { app, ipcMain } = require("electron"); app.disableHardwareAcceleration();
const root = process.env.AI_DECK_QA_ROOT, appDir = process.env.AI_DECK_QA_APP, phase = process.env.AI_DECK_QA_PHASE;
const restore = phase === "restore", profile = process.env.AI_DECK_PROFILE_DIRECTORY = path.join(root, "profile");
const performanceProbe = process.env.AI_DECK_QA_PERFORMANCE === "1";
const cwd = path.join(root, "chat-folder"), codexFile = path.join(root, "codex.json"), idsFile = path.join(root, "ids.json");
const claudeRoot = process.env.CLAUDE_CONFIG_DIR = path.join(root, "claude"), claudeFolder = path.join(claudeRoot, "projects", "fixture");
process.env.CODEX_HOME = path.join(root, "codex");
for (const directory of [profile, cwd, claudeFolder]) fs.mkdirSync(directory, { recursive: true });
const ids = restore ? JSON.parse(fs.readFileSync(idsFile)) : { a: randomUUID(), b: randomUUID() };
const sessions = [{ key: "a", provider: "codex", id: ids.a, title: "Native alpha" },
  { key: "b", provider: "codex", id: ids.b, title: "Native beta" },
  { key: "c", provider: "claude", id: ids.a, title: "Native Claude" }]; // Same ID, different providers.
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
  fs.writeFileSync(path.join(profile, "workspace-state.json"), JSON.stringify({ executables, currentRepo: cwd, lowMemory: false, closeToTray: false,
    workspaces: { [cwd]: { repo: cwd, chatOnly: true, tasks, currentTask: tasks[0].id, notes: [], plugins: [], instructions: "" } },
    agentSettings: { codex: { model: "wrong-global-model" }, claude: { model: "wrong-global-model" } }, preferences: { notifications: "off" } }));
  turns = Object.fromEntries([ids.a, ids.b].map(id => [id, [{ id: randomUUID(), status: "completed", items: [
    { type: "userMessage", id: randomUUID(), content: [{ type: "text", text: "Original question" }] },
    { type: "agentMessage", id: randomUUID(), text: "Original answer" },
  ] }]]));
  if (performanceProbe) turns[ids.a] = Array.from({ length: 240 }, (_, index) => ({ id: randomUUID(), status: "completed", items: [
    { type: "userMessage", id: randomUUID(), content: [{ type: "text", text: "Long history fixture question " + index }] },
    { type: "agentMessage", id: randomUUID(), text: "Long history fixture reply " + index + "\n\n" +
      "- Keep the input API compatible.\n- Preserve the saved draft.\n\n```js\nconst output = await readValue(input);\n```\n\n| Check | Result |\n| --- | --- |\n| Input | Observed |" },
  ] }));
  fs.writeFileSync(codexFile, JSON.stringify(turns)); appendClaude("user", "Native Claude"); appendClaude("assistant", "Original Claude answer");
} else turns = JSON.parse(fs.readFileSync(codexFile));
const report = { phase, calls: [], checks: [], timings: [] }, active = new Set();
const save = () => fs.writeFileSync(path.join(root, phase + ".json"), JSON.stringify(report, null, 2));
process.on("uncaughtException", error => { report.error = error.stack; save(); app.exit(1); });
const engines = require(path.join(appDir, "engines.cjs"));
engines.capture = async (exe, args) => ({ code: 0, stderr: "", stdout: args[0] === "--version"
  ? /claude/u.test(exe) ? "2.1.319 (Claude Code)" : "codex-cli 0.0.0"
  : args[0] === "auth" ? JSON.stringify({ loggedIn: true }) : "Logged in using ChatGPT" });
engines.inspectClaude = async () => ({ models: [{ value: "sonnet", displayName: "Sonnet fixture", supportsEffort: true, supportedEffortLevels: ["low", "high"] }] });
function runner(provider, id, prompt, options) {
  report.calls.push({ provider, id, prompt, model: options.model, effort: options.effort, speed: options.speed }); active.add(provider + id);
  const turn = { id: randomUUID(), status: "inProgress", items: [{ type: "userMessage", id: randomUUID(), content: [{ type: "text", text: prompt }] }] };
  if (provider === "codex") turns[id].unshift(turn); else appendClaude("user", prompt);
  return delay(140).then(() => {
    active.delete(provider + id); turn.status = "completed";
    if (provider === "codex") { turn.items.push({ type: "agentMessage", id: randomUUID(), text: "Reply: " + prompt }); fs.writeFileSync(codexFile, JSON.stringify(turns)); }
    else appendClaude("assistant", "Reply: " + prompt);
    return { status: "completed", sessionId: id };
  });
}
engines.CodexEngine = class {
  constructor() {} async initialize() {} async shutdown() {} close() {} async interrupt() {}
  async request(method, payload) {
    if (method === "thread/list") return { data: payload.archived ? [] : sessions.filter(s => s.provider === "codex").map(s => ({ id: s.id, name: s.title, cwd, updatedAt: 1000 })) };
    if (method === "thread/read") return { thread: { id: payload.threadId, cwd, status: { type: active.has("codex" + payload.threadId) ? "active" : "idle" }, updatedAt: 1000 } };
    if (method === "thread/turns/list") return { data: turns[payload.threadId] };
    if (method === "config/read") return { config: {} };
    if (method === "model/list") return { data: ["a", "b"].map(key => ({ model: "gpt-fixture-" + key, displayName: "GPT " + key,
      supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }], serviceTiers: [{ id: "priority" }] })) };
    if (method === "thread/resume") return { thread: { id: payload.threadId }, model: payload.model };
    throw Error("Unexpected provider operation " + method);
  }
  async run(id, _cwd, prompt, _readOnly, options) { return runner("codex", id, prompt, options); }
};
engines.runClaude = (_exe, _cwd, prompt, _plugins, id, _emit, options) => ({ done: runner("claude", id, prompt, options), close() {}, async stop() {} });
let holdReply = false, replyFinished = false, releaseReply, holdSave = false, saveFinished = false, releaseSave, pendingSteps = false;
let replyGate, saveGate;
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (key, fn) => handle(key, async (...args) => {
  if (key === "deck:quota-summary") return null;
  const result = await fn(...args);
  if (pendingSteps && key === "deck:native-session-preview" && args[1].id === ids.a) {
    result.chat = { ...result.chat, active: true, pending: { requestId: "performance-work", prompt: "Observed work fixture", events:
      Array.from({ length: 120 }, (_, index) => ({ type: "activity", text: "Detailed work step " + index + "\n" + "Recorded output. ".repeat(200) })) } };
  }
  if (key === "deck:native-chat-send" && holdReply && args[1].provider === "codex" && args[1].id === ids.a) { replyFinished = true; await replyGate; }
  if (key === "deck:save-native-chat-models" && holdSave) { saveFinished = true; await saveGate; }
  return result;
});
const wait = async (fn, label) => { const until = Date.now() + 15000; while (Date.now() < until) { if (await fn()) return; await delay(40); } throw Error("Timeout " + label); };
let seeded = restore || performanceProbe, started = false;
app.once("browser-window-created", (_, win) => win.webContents.on("did-finish-load", async () => {
  const js = code => win.webContents.executeJavaScript(code, true);
  const api = (key, payload) => js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(payload) ?? ""})`);
  const click = label => js(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.checkVisibility()&&!e.disabled&&(e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)}));if(!e)return false;e.click();return true})()`);
  const type = (text, selector = ".deck-native-chat textarea") => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const open = async key => {
    const session = sessions.find(s => s.key === key), start = performance.now();
    await click("Recents"); await wait(() => click((session.provider === "codex" ? "Codex" : "Claude Code") + ": " + session.title), "open " + key);
    await wait(() => js(`Boolean(document.querySelector('.deck-native-chat textarea'))&&document.querySelector('.deck-native-chat .thread-hint')?.textContent.includes('Replies are saved')`), "chat ready " + key);
    report.timings.push({ key, openMs: Math.round(performance.now() - start) });
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
    await api("pull-native-recents");
    if (performanceProbe) {
      await open("a");
      await wait(() => js("document.querySelectorAll('.deck-native-reply').length === 240"), "long transcript");
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
      assert.equal(measurements.messages, 480);
      if (process.env.AI_DECK_QA_ALLOW_HISTORY_REBUILD !== "1") assert.equal(measurements.passes, 0, "Typing must reuse the loaded transcript instead of walking old messages");
      assert.equal(await draft(), "Performance draft 11");
      assert.equal(await js("(()=>{const block=document.querySelector('.deck-code-block');block.querySelector('button[aria-label=\"Disable word wrap\"]').click();return true})()"), true);
      await wait(() => js("document.querySelector('.deck-code-block').dataset.wrap === 'off'"), "code block remains interactive");
      assert.equal(await click("Chat actions"), true); assert.equal(await click("Search in chat"), true);
      await js("(()=>{const input=document.querySelector('input[aria-label=\"Search in this chat\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'fixture reply 239');input.dispatchEvent(new Event('input',{bubbles:true}))})()");
      await wait(() => js("document.querySelectorAll('.deck-native-reply').length === 1"), "search updated transcript");
      assert.equal(await click("Close search"), true);
      await wait(() => js("document.querySelectorAll('.deck-native-reply').length === 240"), "restore full transcript");
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
  .replace("read: createUpdateReader({ capture,", "read: async () => [], unusedReader: createUpdateReader({ capture,"), main);
