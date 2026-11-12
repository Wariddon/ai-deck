const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { test, mock } = require("node:test");
const { nativeChromeRequested, nativeChromeTools, nativeChromeDecision, claudeMemoryPreferences, chromePrefix } = require("../desktop/native-capabilities.cjs");
const { readNativeCloud } = require("../desktop/native-cloud.cjs");

test("native Chrome is on demand and native tools stay off for tool-free turns", () => {
  for (const text of ["สวัสดี", "Chrome กับ Firefox ต่างกันยังไง", "แก้ปุ่มบันทึก", "Read the source file", "ไม่ต้องเปิด Chrome", "Don't open Chrome"]) assert.equal(nativeChromeRequested(text), false);
  for (const text of ["ช่วยเปิด Chrome ตรวจหน้านี้", "Inspect Chrome", "@Chrome เช็คเว็บนี้"]) assert.equal(nativeChromeRequested(text), true);
  const { claudeArguments } = require("../desktop/engines.cjs");
  assert.ok(claudeArguments([], null, { interactive: true, role: "write" }).includes("--no-chrome"));
  assert.ok(claudeArguments([], "same-chat", { interactive: true, role: "review", nativeChrome: true }).includes("--chrome"));
  assert.ok(claudeArguments([], null, { role: "test", nativeChrome: true, interactive: true }).includes("--no-chrome"));
  assert.deepEqual(nativeChromeTools({ mcpServers: [{ name: "untrusted", status: "connected", tools: [{ name: "computer" }] }] }), []);
  assert.equal(nativeChromeDecision(chromePrefix + "computer", { action: "left_click" }), "ask");
  assert.equal(nativeChromeDecision(chromePrefix + "computer", { action: "screenshot" }), "allow");
  assert.equal(nativeChromeDecision(chromePrefix + "javascript_tool", { text: "fetch('/change')" }), "ask");
  assert.equal(nativeChromeDecision(chromePrefix + "read_page", {}, false), "deny");
  assert.equal(nativeChromeDecision(chromePrefix + "browser_batch", { code: "x".repeat(12001) }), "deny");
});

test("native memory reuses user preferences without importing hooks or project memory redirects", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-native-memory-"));
  try {
    const home = path.join(root, "home"), cwd = path.join(root, "project");
    fs.mkdirSync(home); fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, "settings.json"), JSON.stringify({ autoMemoryEnabled: false, hooks: { unsafe: true }, env: { SECRET: "must-not-import" } }));
    fs.writeFileSync(path.join(cwd, ".claude", "settings.json"), JSON.stringify({ autoMemoryEnabled: true, autoMemoryDirectory: root }));
    assert.deepEqual(claudeMemoryPreferences(cwd, { home, env: {} }), { autoMemoryEnabled: false });
    fs.writeFileSync(path.join(home, "settings.json"), JSON.stringify({ autoMemoryEnabled: true, autoMemoryDirectory: path.join(home, "memory") }));
    fs.writeFileSync(path.join(cwd, ".claude", "settings.local.json"), '{"autoMemoryEnabled":false}');
    assert.deepEqual(claudeMemoryPreferences(cwd, { home, env: {} }), { autoMemoryEnabled: false, autoMemoryDirectory: path.join(home, "memory") });
    assert.equal(claudeMemoryPreferences(null, { home, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } }).autoMemoryEnabled, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Codex Cloud bridge only runs bounded official read commands", async () => {
  const calls = [], run = async (exe, args, options) => { calls.push({ exe, args, options }); return { code: 0, stdout: args.includes("--json") ? '{"tasks":[{"id":"task_1","title":"Saved task","status":"done"}],"cursor":"next"}' : "x".repeat(17000), stderr: "" }; };
  const listed = await readNativeCloud("codex.exe", {}, { run });
  assert.equal(listed.tasks[0].id, "task_1"); assert.equal(listed.more, true);
  assert.deepEqual(calls[0].args, ["cloud", "list", "--json", "--limit", "20"]);
  const diff = await readNativeCloud("codex.exe", { action: "diff", id: "task_1" }, { run });
  assert.equal(diff.text.length, 16000); assert.equal(diff.truncated, true);
  await assert.rejects(readNativeCloud("codex.exe", { action: "apply", id: "task_1" }, { run }), /read-only/u);
  await assert.rejects(readNativeCloud("codex.exe", { action: "diff", id: "--help" }, { run }), /valid/u);
  assert.equal(calls.length, 2);
});

class Cli extends EventEmitter {
  constructor(onInput) {
    super(); this.stdout = new PassThrough(); this.stderr = new PassThrough();
    this.stdin = new Writable({ write: (chunk, _, done) => { onInput(this, JSON.parse(chunk.toString())); done(); }, final: done => { queueMicrotask(() => this.kill()); done(); } });
  }
  send(value) { this.stdout.write(JSON.stringify(value) + "\n"); }
  kill() { if (this.closed) return; this.closed = true; this.stdout.end(); this.stderr.end(); this.emit("close", 0); }
}

test("native Chrome discovers the native server, approves changes even in Full access, and revokes reads", async () => {
  const reply = (child, id, response = {}) => child.send({ type: "control_response", response: { request_id: id, subtype: "success", response } });
  const hook = (child, id, name, input = {}) => child.send({ type: "control_request", request_id: id, request: { subtype: "hook_callback", callback_id: "deck-tools", input: { tool_name: chromePrefix + name, tool_input: input } } });
  let run, active = true, calls = 0, approvals = 0;
  const replacement = mock.method(require("node:child_process"), "spawn", (_exe, args) => {
    assert.ok(args.includes("--chrome"));
    return new Cli((child, message) => {
      if (message.request?.subtype === "initialize") reply(child, message.request_id);
      else if (message.request?.subtype === "mcp_status") reply(child, message.request_id, { mcpServers: [{ name: "claude-in-chrome", status: "connected", tools: [{ name: "read_page" }, { name: "computer" }] }] });
      else if (message.type === "user") { calls++; hook(child, "read", "read_page"); }
      else if (message.response?.request_id === "read") {
        assert.equal(message.response.response.hookSpecificOutput.permissionDecision, "allow"); hook(child, "click", "computer", { action: "left_click", coordinate: [1, 2] });
      } else if (message.response?.request_id === "click") {
        assert.equal(message.response.response.hookSpecificOutput.permissionDecision, "allow");
        active = false; hook(child, "after-revoke", "read_page");
      } else if (message.response?.request_id === "after-revoke") {
        assert.equal(message.response.response.hookSpecificOutput.permissionDecision, "deny");
        child.send({ type: "result", session_id: "same-chat", result: "done", is_error: false });
      }
    });
  });
  const filename = require.resolve("../desktop/engines.cjs"); delete require.cache[filename];
  try {
    run = require(filename).runClaude("fixture.exe", process.cwd(), "Inspect Chrome", [], "same-chat", event => {
      if (event.type === "approval") { approvals++; queueMicrotask(() => run.decide(event.key, true)); }
    }, { interactive: true, role: "write", nativeChrome: true, nativeChromeActive: () => active, permissionMode: "full" });
    assert.equal((await run.done).status, "completed"); assert.equal(calls, 1); assert.equal(approvals, 1);
  } finally { replacement.mock.restore(); delete require.cache[filename]; }
});

test("missing native Chrome stops before sending a billed model prompt", async () => {
  let calls = 0;
  const replacement = mock.method(require("node:child_process"), "spawn", () => new Cli((child, message) => {
    if (message.request) child.send({ type: "control_response", response: { request_id: message.request_id, subtype: "success", response: { mcpServers: [] } } });
    if (message.type === "user") calls++;
  }));
  const filename = require.resolve("../desktop/engines.cjs"); delete require.cache[filename];
  try {
    const result = await require(filename).runClaude("fixture.exe", process.cwd(), "Inspect Chrome", [], null, () => {}, { nativeChrome: true, interactive: true, role: "review" }).done;
    assert.equal(result.status, "failed"); assert.match(result.error, /Chrome is unavailable/u); assert.equal(calls, 0);
  } finally { replacement.mock.restore(); delete require.cache[filename]; }
});

test("revoking native Chrome cancels the provider turn instead of leaving native batches running", async () => {
  let run, calls = 0, interrupts = 0;
  const replacement = mock.method(require("node:child_process"), "spawn", () => new Cli((child, message) => {
    if (message.request) {
      if (message.request.subtype === "interrupt") interrupts++;
      child.send({ type: "control_response", response: { request_id: message.request_id, subtype: "success", response: {
        mcpServers: [{ name: "claude-in-chrome", status: "connected", tools: [{ name: "browser_batch" }] }]
      } } });
    }
    if (message.type === "user") { calls++; queueMicrotask(() => run.revokeNativeChrome()); }
  }));
  const filename = require.resolve("../desktop/engines.cjs"); delete require.cache[filename];
  try {
    run = require(filename).runClaude("fixture.exe", process.cwd(), "Inspect Chrome", [], null, () => {}, { nativeChrome: true, interactive: true, role: "review" });
    assert.equal((await run.done).status, "interrupted"); assert.equal(calls, 1); assert.equal(interrupts, 1);
  } finally { replacement.mock.restore(); delete require.cache[filename]; }
});
