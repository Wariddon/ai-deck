// Exercise bundled guidance through the actual application; providers are simulated.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"), { randomUUID } = require("node:crypto"), { setTimeout: delay } = require("node:timers/promises");
const { app, ipcMain } = require("electron"); app.disableHardwareAcceleration();
const root = process.env.AI_DECK_QA_ROOT, appDir = process.env.AI_DECK_QA_APP, profile = process.env.AI_DECK_PROFILE_DIRECTORY = path.join(root, "profile");
const restoring = process.env.AI_DECK_QA_RESTORE === "1";
process.env.CODEX_HOME = path.join(root, "codex"); process.env.CLAUDE_CONFIG_DIR = path.join(root, "claude");
const repo = path.join(root, "project"); fs.mkdirSync(profile, { recursive: true }); fs.mkdirSync(repo, { recursive: true });
const git = (cwd, args) => execFileSync("git", args, { cwd, windowsHide: true, encoding: "utf8" }).trim();
if (!restoring) {
git(repo, ["init", "-q", "-b", "main"]);
fs.writeFileSync(path.join(repo, "service.js"), "export function readValue(input) { return input; }\n");
fs.writeFileSync(path.join(repo, "README.md"), "Fixture project\n");
git(repo, ["add", "."]); git(repo, ["-c", "user.name=QA", "-c", "user.email=qa@example.test", "commit", "-qm", "fixture"]);
}
const definitions = [
  { mode: "build-review", writer: "codex" }, { mode: "claude-build-review", writer: "claude" },
  { mode: "session-team", writer: "codex" }, { mode: "session-team", writer: "claude" },
  { mode: "auto-team", writer: "codex", plan: true },
  { mode: "build-review", writer: "codex", docs: true },
  { mode: "session-team", writer: "claude", disabled: true },
  { mode: "auto-team", writer: "codex", plan: true, disabled: true },
  { mode: "codex-plan-claude", writer: "claude", pair: true },
  { mode: "claude-plan-codex", writer: "codex", pair: true },
  { mode: "session-team", writer: "codex", sessionPlan: true },
  { mode: "session-team", writer: "claude", sessionPlan: true },
];
const contract = entry => ({ inputs: ["case " + entry.index + " readValue(input) interface"],
  outputs: ["case " + entry.index + " service.js and observed check evidence"], readyWhen: ["case " + entry.index + " rejected input stays observable; missing checks remain explicit"] });
const { newTask } = require(path.join(appDir, "tasks.cjs"));
const tasks = definitions.map((entry, index) => {
  const task = newTask(); entry.id = task.id; entry.index = index; task.title = "Shared skill case " + index;
  if (entry.mode === "session-team") task.sessionTeam = { members: [
    { id: "member-" + randomUUID(), name: entry.sessionPlan ? "Planner" : "Builder", provider: entry.writer, position: entry.sessionPlan ? "plan" : "write" },
    { id: "member-" + randomUUID(), name: entry.sessionPlan ? "Builder" : "Reviewer", provider: entry.writer === "codex" ? "claude" : "codex", position: entry.sessionPlan ? "write" : "review" },
  ] };
  return task;
});
const executables = {};
for (const provider of ["codex", "claude"]) { executables[provider] = path.join(root, "fixture-" + provider + ".exe"); fs.writeFileSync(executables[provider], "fixture"); }
if (!restoring) fs.writeFileSync(path.join(profile, "workspace-state.json"), JSON.stringify({ executables, currentRepo: repo, lowMemory: true, closeToTray: false,
  workspaces: { [repo]: { repo, tasks, currentTask: tasks[0].id, notes: [], plugins: [], instructions: "", shareNewFiles: true } }, preferences: { notifications: "off" } }));
const report = restoring ? JSON.parse(fs.readFileSync(path.join(root, "result.json"), "utf8")) : { calls: [], cases: [] }, threads = new Map(); let current, releaseLivePlan;
const snapshot = task => ({ id: task.taskId ?? task.id, codexThread: task.codexThread ?? null, claudeSession: task.claudeSession ?? null,
  plans: task.runHistory.flatMap(run => run.teamPlan ? [{ id: run.id, plan: run.teamPlan }] : Object.entries(run.teamReview?.plans ?? {}).map(([id, plan]) => ({ id, plan }))) });
const save = () => fs.writeFileSync(path.join(root, "result.json"), JSON.stringify(report, null, 2));
process.on("uncaughtException", error => { report.error = error.stack; save(); app.exit(1); });
const engines = require(path.join(appDir, "engines.cjs")), capture = engines.capture;
engines.capture = (exe, args, options) => /^git(?:\.exe)?$/iu.test(path.basename(exe)) ? capture(exe, args, options) : Promise.resolve({ code: 0, stderr: "", stdout: args[0] === "--version"
  ? /claude/u.test(exe) ? "2.1.319 (Claude Code)" : "codex-cli 0.0.0" : args[0] === "auth" ? JSON.stringify({ loggedIn: true }) : "Logged in using ChatGPT" });
engines.inspectClaude = async () => ({ models: [{ value: "sonnet", displayName: "Sonnet fixture", supportsEffort: true, supportedEffortLevels: ["low", "medium"] }] });
async function turn(provider, cwd, prompt, readOnly, emit) {
  if (restoring) { report.unexpectedProviderCall = true; save(); throw Error("Restart must not replay a model turn"); }
  report.calls.push({ index: current.index, provider, readOnly, prompt }); emit({ type: "provider-call" });
  if (current.sessionPlan && !readOnly) await new Promise(resolve => { releaseLivePlan = resolve; });
  await delay(15);
  let answer;
  if (current.plan) answer = prompt.includes("Start with exactly one line: AI_DECK_AUTO")
    ? "AI_DECK_AUTO: CODEX\n" + JSON.stringify({ requiredBase: git(cwd, ["rev-parse", "HEAD"]), summary: "One writer changes service.js; peer reviews failure preservation.", assignments: {
      codex: { task: "Make readValue preserve failures", paths: ["service.js"], acceptance: ["A failed read remains observable"], ...contract(current) },
      claude: { task: "Review failure preservation", paths: [], acceptance: ["Check observed failures"], ...contract(current) },
    } }) : "Assign service.js to one builder; the peer checks rejection and saved-state preservation. Keep one shared interface.";
  else if ((current.pair || current.sessionPlan) && readOnly) answer = "AI_DECK_PLAN: READY\n" + JSON.stringify({
    summary: "Implement service.js against its input API and inspect rejected input. ".repeat(50), ...contract(current),
  });
  else if (!readOnly) {
    fs.writeFileSync(path.join(cwd, current.docs ? "README.md" : "service.js"), current.docs
      ? "Fixture documentation for catch and fallback behavior.\n"
      : "export async function readValue(input) { try { return await input; } catch (error) { throw error; } }\n");
    answer = "Changed the assigned file. The peer should check the changed failure behavior and assertions. No external delivery was tested.";
  } else answer = "AI_DECK_REVIEW: PASS\nThe diff preserves rejected input. Test coverage has not been established by this simulated response.";
  emit({ type: "message", key: randomUUID(), text: answer });
  return { status: "completed", answer, sessionId: randomUUID() };
}
engines.CodexEngine = class {
  constructor(_exe, cwd, _plugins, emit) { this.cwd = cwd; this.emit = emit; }
  async initialize() {} async shutdown() {} close() {} async interrupt() {}
  async request(method, payload) {
    if (method === "config/read") return { config: {} };
    if (method === "model/list") return { data: [{ model: "gpt-fixture", displayName: "GPT fixture", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }] };
    if (method === "thread/start") { const id = randomUUID(); threads.set(id, this.cwd); return { thread: { id }, model: "gpt-fixture" }; }
    if (method === "thread/resume") return { thread: { id: payload.threadId }, model: "gpt-fixture" };
    if (method === "thread/name/set") return {};
    if (method === "thread/list") return { data: [] };
    throw Error("Unexpected provider operation " + method);
  }
  async run(_id, cwd, prompt, readOnly) { return turn("codex", cwd, prompt, readOnly, this.emit); }
};
engines.runClaude = (_exe, cwd, prompt, _plugins, _id, emit, options) => ({ done: turn("claude", cwd, prompt, options.role !== "write", emit), close() {}, canSteer() { return false; }, async stop() {} });
const handle = ipcMain.handle.bind(ipcMain); ipcMain.handle = (key, fn) => handle(key, (...args) => key === "deck:quota-summary" ? null : fn(...args));
const wait = async (fn, label) => { const until = Date.now() + 15000; while (Date.now() < until) { if (await fn()) return; await delay(40); } throw Error("Timeout " + label); };
app.once("browser-window-created", (_, win) => win.webContents.once("did-finish-load", async () => {
  const js = code => win.webContents.executeJavaScript(code, true);
  const api = (key, payload) => js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(payload) ?? ""})`);
  try {
    await wait(() => js("Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')"), "startup");
    if (restoring) {
      for (const expected of report.savedTasks) {
        await api("switch-task", { repo, id: expected.id });
        const state = await api("state");
        assert.deepEqual(snapshot(state.workspace), expected, "Saved contracts and native IDs must survive an application restart");
        assert.equal(state.jobs.length, 0);
      }
      await delay(250);
      assert.equal(report.unexpectedProviderCall, undefined);
      report.restarted = true; save(); app.quit(); return;
    }
    for (current of definitions) {
      await api("switch-task", { repo, id: current.id });
      if (current.sessionPlan) {
        await new Promise(resolve => { win.webContents.once("did-finish-load", resolve); win.webContents.reload(); });
        await wait(() => js("Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')"), "session planner renderer");
      }
      const before = report.calls.length;
      await api("run", { taskId: current.id, repo, mode: current.mode, messageIntent: "edit", reviewPolicy: "economy", teamOptions: { turnLimit: 2, ...(current.disabled && { teamReviewSkill: false }) },
        prompt: current.docs ? "Edit README.md to explain the error fallback behavior." : "Edit service.js so rejected input stays observable. Preserve existing data and verify the behavior." });
      if (current.sessionPlan) {
        await wait(() => Boolean(releaseLivePlan), "builder receives plan");
        try {
          await wait(() => js(`document.body.innerText.includes(${JSON.stringify(contract(current).readyWhen[0])})&&!document.body.innerText.includes('Checking the team plan…')`), "live saved plan before builder completes");
          report.livePlans = (report.livePlans ?? 0) + 1;
        } finally { releaseLivePlan(); releaseLivePlan = null; }
      }
      await wait(async () => { const s = await api("state"); return !s.jobs.length && s.workspace.runHistory.at(-1)?.finishedAt; }, "run " + current.index);
      if (current.pair) {
        const planned = (await api("state")).workspace.runHistory.at(-1);
        assert.equal(planned.teamPlan.state, "ready");
        assert.deepEqual(planned.teamPlan.readyWhen, contract(current).readyWhen);
        // Direct IPC task selection does not update React's selected workspace.
        // Reload the real renderer from the persisted current task before inspecting it.
        await new Promise(resolve => { win.webContents.once("did-finish-load", resolve); win.webContents.reload(); });
        await wait(() => js("Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')"), "plan renderer");
        assert.ok((await js("document.body.innerText")).includes(contract(current).outputs[0]), "Plan contract must be reviewable in the existing thread");
        assert.ok(!(await js("[...document.querySelectorAll('.thread-message')].map(node => node.innerText).join('\\n')")).includes("AI_DECK_PLAN"), "The visible plan must not expose raw protocol JSON");
        if (current.index === 8) {
          await js("[...document.querySelectorAll('.setting-detail strong')].find(node => node.textContent === 'Outputs')?.scrollIntoView({ block: 'center' })");
          fs.writeFileSync(path.join(root, "plan-contract.png"), (await win.webContents.capturePage()).toPNG());
        }
        const preview = await api("preview-continuation", planned.id);
        assert.deepEqual(preview.contract, contract(current));
        const source = globalThis.__deckSkillQaStorage.workspaces[repo].tasks.find(task => task.id === current.id).runHistory.at(-1).teamPlan;
        source.readyWhen.push("Changed after the approval preview");
        await assert.rejects(api("continue-run", { runId: planned.id, stamp: preview.stamp, acceptChanges: true }), /fresh review/u);
        assert.equal(report.calls.length - before, 1, "A changed contract must not send an unapproved model turn");
        source.readyWhen.pop();
        await api("continue-run", { runId: planned.id, stamp: preview.stamp, acceptChanges: true });
        await wait(async () => { const s = await api("state"); return !s.jobs.length && s.workspace.runHistory.at(-1)?.finishedAt; }, "apply " + current.index);
        const applied = (await api("state")).workspace.runHistory;
        const sourcePlan = applied.find(run => run.id === planned.id).teamPlan;
        assert.equal(sourcePlan.applyRunId, applied.at(-1).id);
        assert.equal(sourcePlan.applyStatus, applied.at(-1).implementationEvidence.status);
      }
      const state = await api("state"), run = state.workspace.runHistory.at(-1), calls = report.calls.slice(before);
      assert.equal(calls.length, 2, "Guidance must not add model calls: " + JSON.stringify(run.agents));
      const owner = run.collaboration ?? run.autoTeam ?? run.teamReview, usage = owner?.skillUsage ?? [];
      if (current.pair || current.sessionPlan) {
        const planner = calls.find(call => call.readOnly), builder = calls.find(call => !call.readOnly);
        assert.ok(planner.prompt.includes('"readyWhen"'));
        assert.ok(builder.prompt.includes(contract(current).inputs[0]));
        assert.ok(builder.prompt.includes(contract(current).outputs[0]));
        assert.ok(builder.prompt.includes(contract(current).readyWhen[0]), "The contract must survive a summary longer than the handoff excerpt");
        assert.ok(builder.prompt.includes("requirements, not evidence of completion"));
        for (const other of definitions.filter(entry => entry.index !== current.index)) assert.ok(!builder.prompt.includes(contract(other).readyWhen[0]), "Contracts stay within their own task");
        if (current.sessionPlan) {
          const savedPlan = Object.values(run.teamReview.plans)[0];
          assert.deepEqual(savedPlan.inputs, contract(current).inputs);
          assert.deepEqual(savedPlan.readyWhen, contract(current).readyWhen);
        }
      } else if (current.disabled) {
        assert.equal(usage.length, 0);
        assert.ok(calls.every(call => !call.prompt.includes("AI Deck Team Review skill for this stage")));
      } else if (current.plan) {
        assert.equal(run.teamPlan?.state, "ready", JSON.stringify(run.teamPlan));
        assert.equal(usage.length, 2, "Both actual planner calls must retain their guidance snapshot");
        assert.ok(usage.every(entry => entry.skills.includes("writing-plans")));
        assert.ok(calls.every(call => call.prompt.includes("testable deliverable for each role")));
        assert.deepEqual(run.teamPlan.assignments.codex.readyWhen, contract(current).readyWhen);
      } else {
        const writer = calls.find(call => !call.readOnly), reviewer = calls.find(call => call.readOnly);
        assert.equal(writer.provider, current.writer); assert.notEqual(reviewer.provider, writer.provider);
        const writerUse = usage.find(entry => entry.skills.includes("writing-plans"));
        assert.ok(writerUse, "Builder must receive the handoff guidance");
        const reviewerUse = usage.find(entry => entry.agent !== writerUse.agent);
        assert.ok(reviewerUse, "Reviewer must have a recorded guidance snapshot");
        assert.equal(reviewerUse.skills.includes("pr-test-analyzer"), !current.docs);
        assert.equal(reviewerUse.skills.includes("silent-failure-hunter"), !current.docs);
        assert.ok(!writer.prompt.includes("Trace the changed failure path"));
        assert.equal(reviewer.prompt.includes("Trace the changed failure path"), !current.docs);
      }
      report.cases.push({ index: current.index, mode: current.mode, writer: current.writer, turns: calls.length,
        guideUsage: usage, plan: run.teamPlan?.state }); save();
    }
    const persisted = JSON.parse(fs.readFileSync(path.join(profile, "workspace-state.json"), "utf8"));
    const savedTasks = persisted.workspaces[repo].tasks;
    report.savedTasks = savedTasks.map(snapshot);
    for (const entry of definitions.filter(entry => entry.pair || entry.plan || entry.sessionPlan)) {
      const task = savedTasks.find(task => task.id === entry.id);
      const plans = task.runHistory.flatMap(run => run.teamPlan ? [run.teamPlan] : Object.values(run.teamReview?.plans ?? {}));
      assert.ok(plans.some(plan => JSON.stringify(plan).includes(contract(entry).readyWhen[0])), "Contracts must be saved to disk");
    }
    report.passed = true;
  } catch (error) { report.error = error.stack; report.ui = await js("document.body.innerText.slice(-1500)").catch(() => ""); }
  finally { save(); app.quit(); }
}));
const main = path.join(appDir, "main.cjs"), boot = new Module(main, module); boot.filename = main; boot.paths = Module._nodeModulePaths(appDir);
boot._compile(fs.readFileSync(main, "utf8").replace("width: 1240, height: 800", "show: false, width: 1240, height: 800")
  .replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation', 'offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation')
  .replace("read: createUpdateReader({ capture,", "read: async () => [], unusedReader: createUpdateReader({ capture,") +
  "\nObject.defineProperty(globalThis, '__deckSkillQaStorage', { get: () => storage });", main);
