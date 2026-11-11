// Production UI and IPC with local providers; never reads real auth or sends model prompts.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), assert = require("node:assert/strict");
const { app, ipcMain } = require("electron"), { setTimeout: delay } = require("node:timers/promises");
const root = process.env.AI_DECK_QA_ROOT, appDir = process.env.AI_DECK_QA_APP, main = path.join(appDir, "main.cjs"), restoring = process.env.AI_DECK_QA_RESTORE === "1";
const profile = process.env.AI_DECK_PROFILE_DIRECTORY = path.join(root, "profile");
process.env.CODEX_HOME = path.join(profile, "codex"); process.env.CLAUDE_CONFIG_DIR = path.join(profile, "claude");
const sourceRepo = path.join(profile, "knowledge"), destinationRepo = path.join(profile, "project_bot");
for (const folder of [profile, sourceRepo, destinationRepo]) fs.mkdirSync(folder, { recursive: true });
const sourceId = "54e647d1-cfbf-4206-baff-aac982373e73", destinationId = "261e8c22-3130-4fc8-97c2-efae2a43a37f", runId = "34ede443-32fa-4011-bcd1-f6c321cd8538";
const { newTask } = require(path.join(appDir, "tasks.cjs")), { newRun } = require(path.join(appDir, "run-history.cjs"));
if (!restoring) {
  const run = newRun("auto-team", "Earlier work request", ["codex", "claude"]);
  Object.assign(run, { id: runId, finishedAt: new Date().toISOString(), teamPlan: { state: "blocked", from: "claude", text: "The code is in project_bot. Verify the correct checkout before editing." }, autoTeam: { status: "blocked" } });
  for (const agent of Object.values(run.agents)) agent.status = "completed";
  const source = { ...newTask(), id: sourceId, title: "Old source", runHistory: [run], savedDraft: { mode: "parallel-write", prompt: "Unsent source draft" } };
  const target = { ...newTask(), id: destinationId, title: "Continued task", replanSource: { repo: sourceRepo, taskId: sourceId, runId }, savedDraft: { mode: "build-review", prompt: "Unsent destination draft" } };
  const executables = {}; for (const provider of ["codex", "claude"]) { executables[provider] = path.join(profile, provider + ".exe"); fs.writeFileSync(executables[provider], "fixture"); }
  const workspace = (repo, task) => ({ repo, tasks: [task], currentTask: task.id, notes: [], plugins: [], instructions: "", readOnly: false });
  fs.writeFileSync(path.join(profile, "workspace-state.json"), JSON.stringify({ executables, currentRepo: sourceRepo, workspaces: { [sourceRepo]: workspace(sourceRepo, source), [destinationRepo]: workspace(destinationRepo, target) }, lowMemory: false, closeToTray: false, preferences: { notifications: "off" } }));
}
const result = { version: require(path.join(appDir, "package.json")).version, restoring, checks: [], calls: [] };
const save = () => fs.writeFileSync(path.join(root, restoring ? "restored.json" : "result.json"), JSON.stringify(result, null, 2));
process.on("uncaughtException", (error) => { result.error = error.stack; save(); app.exit(1); });
const engines = require(path.join(appDir, "engines.cjs"));
engines.capture = async (exe, args) => ({ code: 0, stdout: args[0] === "--version" ? (exe.includes("claude") ? "2.1.319 (Claude Code)" : "codex-cli 0.167.1") : args[0] === "auth" ? JSON.stringify({ loggedIn: true, authMethod: "claudeAi" }) : "Logged in using ChatGPT", stderr: "" });
engines.CodexEngine = class {
  constructor(_exe, cwd, _plugins, emit, options) { this.cwd = cwd; this.emit = emit; this.options = options; }
  async initialize() {} async shutdown() {} close() {} async interrupt() {}
  async request(method) { return method === "thread/start" ? { thread: { id: "fixture-thread" } } : method === "thread/list" ? { data: [] } : method === "config/read" ? { config: {} } : {}; }
  async run(_id, _cwd, prompt, readOnly) { assert.equal(readOnly, true); assert.equal(this.options.textOnly, true); result.calls.push({ provider: "codex", textOnly: true }); this.emit({ type: "message", key: "reply", text: "สวัสดีครับ Claude ฝากทักทายกลับด้วยครับ" }); return { status: "completed" }; }
};
engines.runClaude = (_exe, _cwd, _prompt, _plugins, _session, emit, options) => {
  assert.equal(options.role, "test"); result.calls.push({ provider: "claude", textOnly: true });
  return { done: delay(80).then(() => { emit({ type: "answer", text: "สวัสดีครับ Codex รับข้อความแล้วครับ" }); return { status: "completed" }; }), close() {}, async stop() {} };
};
const handle = ipcMain.handle.bind(ipcMain); ipcMain.handle = (name, fn) => handle(name, (...args) => name === "deck:quota-summary" ? null : fn(...args));
app.disableHardwareAcceleration();
app.once("browser-window-created", (_, win) => win.webContents.once("did-finish-load", async () => {
  const js = (code) => win.webContents.executeJavaScript(code, true), api = (key, payload) => js("window.aiDeck[" + JSON.stringify(key) + "](" + (JSON.stringify(payload) ?? "") + ")");
  const wait = async (fn, label) => { for (let i = 0; i < 350; i++) { if (await fn()) return; await delay(50); } throw Error("Timeout: " + label); };
  const click = (label) => js('(()=>{const e=[...document.querySelectorAll("button")].find(e=>!e.disabled&&(e.getAttribute("aria-label")===' + JSON.stringify(label) + '||e.textContent.trim()===' + JSON.stringify(label) + '));if(!e)return false;e.click();return true;})()');
  const draft = () => js('document.querySelector(".thread-composer textarea").value');
  const type = (text) => js('(()=>{const e=document.querySelector(".thread-composer textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,' + JSON.stringify(text) + ');e.dispatchEvent(new Event("input",{bubbles:true}));})()');
  try {
    await wait(() => js('!!document.querySelector("header.thread-top")&&!document.querySelector(".deck-startup")'), "startup");
    if (!restoring) {
      assert.equal(await draft(), "Unsent source draft");
      assert.ok(await js('document.querySelector(".thread-plan-note").textContent.includes("You can keep chatting")'));
      assert.ok(!await js('Boolean(document.querySelector(".thread-plan-attention"))'));
      assert.ok(await click("Open project_bot chat"));
      await wait(async () => (await api("state")).workspace.taskId === destinationId && await draft() === "Unsent destination draft", "existing continuation");
      if (!await js('[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="knowledge"&&e.offsetParent)')) assert.ok(await click("Toggle projects"));
      await wait(() => click("knowledge"), "source project");
      await wait(async () => (await api("state")).workspace.taskId === sourceId && await draft() === "Unsent source draft", "source return");
      result.checks.push("Related chat opens the existing task and preserves both drafts");
      await assert.rejects(api("hide-plan-notice", { taskId: destinationId, runId }), /same chat/);
      assert.ok(await click("Hide plan note"));
      await wait(() => js('!document.querySelector(".thread-plan-note")'), "hide");
      const state = await api("state");
      assert.equal(state.workspace.runHistory[0].teamPlan.state, "blocked");
      assert.equal(state.workspace.tasks.find((task) => task.id === sourceId).attention, undefined);
      assert.ok(!await js('[...document.querySelectorAll(".thread-pending")].some(e=>/needs your decision|Plan blocked/.test(e.textContent))'));
      assert.equal(await draft(), "Unsent source draft");
      assert.equal(state.workspace.tasks.length, 1); assert.equal(result.calls.length, 0);
      result.checks.push("Hiding removes duplicate warnings and sidebar attention without changing the plan, draft or tasks");
      win.setSize(760, 540); await delay(120);
      assert.ok(!await js('document.documentElement.scrollWidth>innerWidth+1'));
    } else {
      assert.ok(!await js('Boolean(document.querySelector(".thread-plan-note"))'));
      assert.equal(await draft(), "Unsent source draft");
      await type("สวัสดี Codex สวัสดี Claude"); assert.ok(await click("Send"));
      await wait(async () => result.calls.length === 2 && !(await api("state")).jobs.length, "two-provider conversation");
      const state = await api("state");
      assert.equal(state.workspace.runHistory[0].teamPlan.state, "blocked");
      assert.equal(state.workspace.runHistory.at(-1).discussion, true);
      assert.equal(state.workspace.runHistory.length, 2);
      assert.equal(state.workspace.worktree, null);
      assert.equal(state.workspace.runHistory.at(-1).agents.codex.status, "completed");
      assert.equal(state.workspace.runHistory.at(-1).agents.claude.status, "completed");
      result.checks.push("Hidden note survives restart and the same chat can run a tool-free Codex/Claude exchange without applying the old plan");
    }
    fs.writeFileSync(path.join(root, restoring ? "chat.png" : "notice-hidden.png"), (await win.webContents.capturePage()).toPNG());
    result.passed = true;
  } catch (error) { result.error = error.stack; result.ui = await js("document.body.innerText.slice(-2200)").catch(() => ""); }
  finally { save(); app.quit(); }
}));
const code = fs.readFileSync(main, "utf8").replace('read: createUpdateReader({ capture,', 'read: async () => [], unusedReader: createUpdateReader({ capture,')
  .replace('width: 1240, height: 800', 'show: false, width: 1240, height: 800')
  .replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation', 'offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation');
const boot = new Module(main, module); boot.filename = main; boot.paths = Module._nodeModulePaths(appDir); boot._compile(code, main);
