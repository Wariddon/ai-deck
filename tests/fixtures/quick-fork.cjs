// Production renderer/preload/backend; isolated history, folders and provider fixtures.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"), { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { app, ipcMain } = require("electron");
const root = process.env.AI_DECK_QA_ROOT, appDir = process.env.AI_DECK_QA_APP;
const noProject = process.env.AI_DECK_QA_NO_PROJECT === "1";
const report = { noProject, calls: [], forks: [] };
const save = () => fs.writeFileSync(path.join(root, "result.json"), JSON.stringify(report, null, 2));
process.on("uncaughtException", error => { report.error = error.stack; save(); app.exit(1); });
app.disableHardwareAcceleration();
const profile = process.env.AI_DECK_PROFILE_DIRECTORY = path.join(root, "profile");
const folder = path.join(root, "source-folder"), repo = path.join(root, "current-project");
const sourceRepo = path.join(root, "source-project");
fs.mkdirSync(profile, { recursive: true }); fs.mkdirSync(folder, { recursive: true });
const git = (cwd, args) => execFileSync("git", args, { cwd, windowsHide: true, encoding: "utf8" });
if (!noProject) for (const cwd of [repo, sourceRepo]) {
  fs.mkdirSync(cwd); git(cwd, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(cwd, "fixture.txt"), "Original checkout\n");
  git(cwd, ["add", "fixture.txt"]);
  git(cwd, ["-c", "user.name=QA", "-c", "user.email=qa@example.test", "commit", "-qm", "fixture"]);
}
const codexId = randomUUID(), claudeId = randomUUID();
const codexCwd = noProject ? folder : sourceRepo;
const codexTurns = [{ id: randomUUID(), status: "completed", items: [
  { type: "userMessage", id: randomUUID(), content: [{ type: "text", text: "Remember the source code ORCHID-427." }] },
  { type: "agentMessage", id: randomUUID(), text: "The source code is ORCHID-427." },
] }];
const claudeRoot = process.env.CLAUDE_CONFIG_DIR = path.join(profile, "claude");
const claudeFolder = path.join(claudeRoot, "projects", "fixture");
process.env.CODEX_HOME = path.join(profile, "codex");
fs.mkdirSync(claudeFolder, { recursive: true });
const claudeFile = path.join(claudeFolder, claudeId + ".jsonl");
const claudeText = ["user", "assistant"].map(type => JSON.stringify({ uuid: randomUUID(), sessionId: claudeId,
  type, cwd: folder, timestamp: new Date().toISOString(), message: { content: [{ type: "text", text: type === "user"
    ? "Remember the source code MAPLE-83." : "The source code is MAPLE-83." }] } })).join("\n") + "\n";
fs.writeFileSync(claudeFile, claudeText);
const { newTask } = require(path.join(appDir, "tasks.cjs"));
const original = newTask(); original.title = "Existing project task"; original.savedDraft = { mode: "build-review", prompt: "Keep project draft" };
const executables = {};
for (const provider of ["codex", "claude"]) { executables[provider] = path.join(profile, provider + ".exe"); fs.writeFileSync(executables[provider], "fixture"); }
fs.writeFileSync(path.join(profile, "workspace-state.json"), JSON.stringify({ executables,
  ...(noProject ? { workspaces: {} } : { currentRepo: repo, workspaces: { [repo]: { repo, tasks: [original], currentTask: original.id,
    notes: [], plugins: [], readOnly: false, instructions: "" } } }),
  lowMemory: false, closeToTray: false, preferences: { notifications: "off", sendOnEnter: true } }));
const engines = require(path.join(appDir, "engines.cjs"));
const originalCapture = engines.capture;
engines.capture = async (exe, args, options) => {
  if (args.includes("-EncodedCommand")) {
    (report.signInTerminals ??= []).push(Buffer.from(args.at(-1), "base64").toString("utf16le"));
    return { code: 0, stdout: "1234", stderr: "" }; // Never open a real sign-in terminal in a fixture.
  }
  return /^git(?:\.exe)?$/i.test(path.basename(exe)) ? originalCapture(exe, args, options) : ({ code: 0, stdout: args[0] === "--version" ? /claude/.test(exe)
  ? "2.1.319 (Claude Code)" : "codex-cli 0.0.0" : args[0] === "auth"
    ? JSON.stringify({ loggedIn: true, authMethod: "claudeAi" }) : "Logged in using ChatGPT", stderr: "" });
};
engines.inspectClaude = async () => ({ models: [{ value: "sonnet", displayName: "Sonnet fixture", supportsEffort: true, supportedEffortLevels: ["low"] }] });
function result(provider, id, prompt, emit) {
  assert.ok(![codexId, claudeId].includes(id), "Forks must not send into source chats");
  report.calls.push({ provider, id, prompt });
  if (report.failNext) {
    report.failNext = false;
    return { status: "failed", sessionId: id, error: "Failed to authenticate: OAuth session expired and could not be refreshed" };
  }
  emit({ type: "message", key: randomUUID(), text: "The source code is " + (prompt.includes("MAPLE-83") ? "MAPLE-83" : "ORCHID-427") + "." });
  return { status: "completed", sessionId: id };
}
engines.CodexEngine = class {
  constructor(_exe, _cwd, _plugins, emit) { this.emit = emit; }
  async initialize() {} async shutdown() {} close() {} async interrupt() {}
  async request(method, payload) {
    if (method === "thread/list") return { data: payload.archived ? [] : [{ id: codexId, name: "Codex source", cwd: codexCwd, updatedAt: 1000 }] };
    if (method === "thread/read") return { thread: { id: codexId, cwd: codexCwd, status: { type: "idle" }, updatedAt: 1000 } };
    if (method === "thread/turns/list") return { data: codexTurns };
    if (method === "thread/start") return { thread: { id: randomUUID() }, model: "gpt-fixture" };
    if (method === "thread/name/set") return {};
    if (method === "model/list") return { data: [{ model: "gpt-fixture", displayName: "GPT fixture", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }] };
    if (method === "config/read") return { config: {} };
    throw new Error("Unexpected operation: " + method);
  }
  async run(id, _cwd, prompt) { return result("codex", id, prompt, this.emit); }
};
engines.runClaude = (_exe, _cwd, prompt, _plugins, _id, emit) => ({
  done: delay(30).then(() => result("claude", randomUUID(), prompt, emit)), close() {}, stop: async () => {}, canSteer: () => false,
});
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (key, fn) => handle(key, (...args) => key === "deck:quota-summary" ? null : fn(...args));
const wait = async (fn, label) => { for (let i = 0; i < 350; i++) { if (await fn()) return; await delay(40); } throw new Error("Timeout: " + label); };
app.once("browser-window-created", (_event, win) => win.webContents.once("did-finish-load", async () => {
  const js = code => win.webContents.executeJavaScript(code, true);
  const api = async (key, payload) => {
    const value = await js(`(async()=>{try{return await window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(payload) ?? ""})}catch(e){return {error:e.message}}})()`);
    if (value?.error) throw new Error(key + ": " + value.error); return value;
  };
  const click = (label, twice = false) => js(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>!e.disabled&&e.checkVisibility()&&(e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)}));if(!e)return false;e.click();${twice ? "e.click();" : ""}return true;})()`);
  const type = async (selector, text) => { await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`); await delay(60); };
  const state = () => api("state");
  const selectSetting = async (label, value) => {
    assert.equal(await js(`(()=>{const label=[...document.querySelectorAll('dialog[open] label')].find(e=>e.querySelector('strong')?.textContent.trim()===${JSON.stringify(label)});const e=label?.querySelector('select');if(!e||e.disabled)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`), true, label);
    await delay(50);
  };
  try {
    await wait(() => js("Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')"), "startup");
    assert.equal(await click("Connections"), true);
    await wait(() => js("[...document.querySelectorAll('button')].filter(e=>e.checkVisibility()&&e.textContent.trim()==='Sign in again').length===2"), "sign-in recovery for stored credentials");
    for (const name of ["Codex", "Claude Code"]) {
      assert.equal(await js(`(()=>{const row=[...document.querySelectorAll('.live-connection')].find(e=>e.querySelector('strong')?.textContent===${JSON.stringify(name)});const button=[...row.querySelectorAll('button')].find(e=>e.textContent==='Sign in again');if(!button||button.disabled)return false;button.click();return true})()`), true);
      await wait(() => report.signInTerminals?.length === (name === "Codex" ? 1 : 2), "sign-in launcher " + name);
      await delay(80);
    }
    assert.equal(await click("Back to workspace"), true);
    await api("pull-native-recents");
    for (const provider of ["codex", "claude"]) for (const recipient of ["team", "codex", "claude"]) {
      const id = provider === "codex" ? codexId : claudeId;
      assert.equal(await click("Recents"), true);
      const label = (provider === "codex" ? "Codex: Codex source" : "Claude Code: Remember the source code MAPLE-83.");
      await wait(() => click(label), "native row " + provider);
      await wait(() => js("Boolean(document.querySelector('.deck-native-chat textarea'))&&/Replies are saved/.test(document.querySelector('.deck-native-chat .thread-hint')?.textContent??'')"), "original composer");
      await type(".deck-native-chat textarea", "Keep source draft " + provider);
      const previous = await state(), count = previous.recent.reduce((n, item) => n + item.tasks.length, 0);
      if (recipient === "team") {
        await click("Chat actions"); await wait(()=>click("Fork to Team", true), "fork action");
      } else {
        const title = provider === "codex" ? "Codex source" : "Remember the source code MAPLE-83.";
        await click("Manage session " + title);
        await wait(()=>click("Fork to " + (recipient === "codex" ? "Codex" : "Claude"), true), "fork menu item");
      }
      await wait(async () => (await state()).workspace?.forkRecipient === recipient && !await js("Boolean(document.querySelector('.deck-native-chat'))"), "quick fork");
      await delay(80);
      const next = await state(), ws = next.workspace;
      assert.equal(next.recent.reduce((n, item) => n + item.tasks.length, 0), count + 1, "Double clicks create one task");
      assert.equal(ws.nativeHandoff.source.id, id);
      assert.equal(ws.savedDraft.prompt, "");
      assert.equal(ws.permissionMode, "ask");
      assert.equal(ws.nativeHandoff.sources[0].messages.length, 2);
      assert.equal(await js("Boolean(document.querySelector('dialog[open]'))"), false, "No fork setup dialog");
      assert.equal(await js("document.querySelector('.thread-composer textarea').value"), "");
      if (provider === "codex") {
        const modelDraft = "Keep unsent model draft " + recipient;
        await type(".thread-composer textarea", modelDraft);
        await wait(() => click("Run options"), "run options");
        const expected = recipient === "team" ? ["codex", "claude"] : [recipient];
        const buttons = await js("[...document.querySelectorAll('.deck-run-controls-panel:popover-open .thread-model-picker')].map(e=>e.getAttribute('aria-label'))");
        assert.deepEqual(buttons, expected.map(agent => (agent === "codex" ? "Codex" : "Claude Code") + " model and effort"), "Run options must not be empty or include the wrong provider");
        await delay(100);
        fs.writeFileSync(path.join(root, "model-menu-" + recipient + ".png"), (await win.webContents.capturePage()).toPNG());
        if (recipient !== "team") {
          const name = recipient === "codex" ? "Codex" : "Claude Code";
          await click(name + " model and effort");
          const model = recipient === "codex" ? "gpt-fixture" : "sonnet";
          await wait(() => js(`Boolean([...document.querySelectorAll('dialog[open] select option')].find(e=>e.value===${JSON.stringify(model)}))&&!document.querySelector('dialog[open] select')?.disabled`), "model catalog");
          await selectSetting("Apply to", "task");
          await selectSetting("Model", model);
          await selectSetting(recipient === "codex" ? "Reasoning effort" : "Effort", "low");
          await selectSetting("Speed", "standard");
          assert.equal(await click("Save for task"), true);
          await wait(async () => (await state()).workspace.agentModels?.[recipient]?.model === model && !await js("Boolean(document.querySelector('dialog[open]'))"), "model settings saved");
          const saved = (await state()).workspace.agentModels[recipient];
          assert.equal(saved.effort, "low"); assert.equal(saved.speed, "standard");
          assert.equal((await state()).workspace.permissionMode, "ask");
          assert.equal(await js("document.querySelector('.thread-composer textarea').value"), modelDraft, "Saving model settings preserves draft");
        } else await js("document.querySelector('.deck-run-controls-panel:popover-open').hidePopover()");
        await type(".thread-composer textarea", "");
      }
      if (!noProject) {
        assert.equal(ws.repo, sourceRepo, "Prefer source repo, otherwise current verified project");
        assert.equal(ws.chatOnly, undefined);
        assert.equal(ws.savedDraft.mode, { team: "build-review", codex: "codex", claude: "claude-write" }[recipient]);
        for (const mode of ["full", "auto", "ask"]) {
          assert.equal(await js("(()=>{const e=document.querySelector('.thread-permission-picker .deck-controls-trigger');if(!e||e.disabled)return false;e.click();return true;})()"), true);
          await wait(() => js(`(()=>{const e=document.querySelector('.thread-permissions-menu:popover-open button[data-permission=${mode}]');if(!e||e.disabled)return false;e.click();return true;})()`), "permission option " + mode);
          await wait(async () => (await state()).workspace.permissionMode === mode, "permission saved " + mode);
        }
        assert.ok(ws.nativeHandoff.target.commit);
        if (provider === "claude" && recipient === "claude") {
          fs.writeFileSync(path.join(root, "project-chat.png"), (await win.webContents.capturePage()).toPNG());
          win.setSize(760, 620); await delay(120);
          assert.equal(await js("document.documentElement.scrollWidth>innerWidth"), false, "Compact page must not scroll horizontally");
          fs.writeFileSync(path.join(root, "project-chat-compact.png"), (await win.webContents.capturePage()).toPNG());
          win.setSize(1240, 800); await delay(80);
        }
      } else assert.equal(ws.savedDraft.askAgent, recipient === "team" ? undefined : recipient);
      report.forks.push({ provider, recipient, taskId: ws.taskId, mode: ws.savedDraft.mode });
      assert.equal(report.calls.length, 0, "Forking must not call any model");
    }
    const ws = (await state()).workspace;
    for (const text of ["สวัสดี บอกโค้ดจากแชทต้นทาง", "บอกโค้ดเดิมอีกที"]) {
      await type(".thread-composer textarea", text);
      assert.equal(await click("Send"), true);
      await wait(async () => { const saved = await state(); return saved.workspace.runHistory.at(-1)?.finishedAt && !saved.jobs.length; }, "solo reply");
      await delay(100);
    }
    assert.deepEqual(report.calls.map(call => call.provider), ["claude", "claude"], "Solo fork stays with Claude on both sends");
    assert.match(report.calls[0].prompt, /MAPLE-83/);
    assert.equal((await state()).workspace.taskId, ws.taskId);
    assert.equal(fs.readFileSync(claudeFile, "utf8"), claudeText);
    assert.equal(codexTurns.length, 1);
    const serialized = await js("localStorage.getItem('ai-deck-native-drafts')");
    assert.match(serialized, /Keep source draft codex/); assert.match(serialized, /Keep source draft claude/);
    report.failNext = true;
    await type(".thread-composer textarea", "Check the expired sign-in once");
    assert.equal(await click("Send"), true);
    await wait(async () => {
      const saved = await state();
      return saved.workspace.runHistory.length === 3 && saved.workspace.runHistory.at(-1)?.finishedAt && !saved.jobs.length;
    }, "expired sign-in");
    const failed = await state();
    assert.equal(failed.connections.claude.status, "signIn");
    assert.equal(failed.connections.codex.status, "ready");
    assert.match(failed.connections.claude.authError, /will not resend automatically/u);
    assert.equal(await click("Connections"), true);
    await wait(() => js("[...document.querySelectorAll('button')].some(e=>e.checkVisibility()&&e.textContent.trim()==='Open sign-in terminal')"), "expired sign-in recovery");
    assert.equal(await click("Open sign-in terminal"), true);
    await wait(() => report.signInTerminals?.length === 3, "expired sign-in launcher");
    await delay(80);
    assert.equal(await click("Back to workspace"), true);
    await assert.rejects(api("provider-models", { agent: "claude" }), /provider rejected this sign-in/u);
    await type(".thread-composer textarea", "Keep my next draft after signing in");
    await wait(async () => (await state()).workspace.recoveryDraft?.draft?.prompt === "Keep my next draft after signing in", "saved next draft");
    assert.equal(report.calls.length, 3, "Authentication failure must not retry a model request");
    assert.equal((await state()).workspace.recoveryDraft.draft.prompt, "Keep my next draft after signing in");
    report.authFailureHandled = true;
    report.passed = true; save(); app.exit(0);
  } catch (error) { report.error = error.stack; report.ui = await js("document.body.innerText.slice(-3500)").catch(()=>""); save(); app.exit(1); }
}));
// Render without depending on a visible Windows desktop/compositor surface.
const Module = require("node:module"), main = path.join(appDir, "main.cjs");
const boot = new Module(main, module);
boot.filename = main;
boot.paths = Module._nodeModulePaths(appDir);
boot._compile(fs.readFileSync(main, "utf8")
  .replace("width: 1240, height: 800", "show: false, width: 1240, height: 800")
  .replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation',
    'offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation'), main);
