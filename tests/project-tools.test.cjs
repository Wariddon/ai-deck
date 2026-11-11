const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFile } = require("node:child_process"), { promisify } = require("node:util"), { test } = require("node:test");
const { createProjectTools, githubRepository } = require("../desktop/project-tools.cjs");
const { remoteClient } = require("../desktop/mcp-client.cjs");
const exec = promisify(execFile);
const git = async (cwd, args) => (await exec("git", ["-c", "core.hooksPath=NUL", "-c", "user.name=AI Deck QA", "-c", "user.email=qa@example.invalid", "-c", "commit.gpgSign=false", ...args], { cwd, windowsHide: true })).stdout;
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-project-tools-"));
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  await git(root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "code.js"), "export function add(x) { return x+1; }\n");
  await git(root, ["add", "."]); await git(root, ["commit", "-qm", "fixture"]);
  return root;
}

test("shared project tools are read-only, scoped to the checkout, revocable and quoted to peers", async t => {
  const root = await fixture(t), observations = [];
  const tools = createProjectTools({ cwd: root, git, runtimeRoot: path.join(root, "runtime"), observe: e => observations.push(e) });
  t.after(() => tools.close());
  const plugin = await tools.lease("codex");
  const rpc = async (name, args) => (await fetch(plugin.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json();
  const result = await rpc("git_read", { action: "status" });
  assert.ok(!result.result.isError); assert.equal(observations.length, 1);
  assert.ok(tools.context("claude").includes("quoted evidence")); assert.equal(tools.context("codex"), "");
  assert.equal((await rpc("git_read", { action: "reset" })).result.isError, true);
  assert.equal((await rpc("github_read", { action: "ci" })).result.isError, true);
  await assert.rejects(tools.call("code_read", { action: "find", symbol: "add", file: "../outside.js" }, "claude"), /inside this task/);
  await assert.rejects(tools.call("git_read", { action: "diff", file: ".env" }, "codex"), /inside this task/);
  assert.equal((await fetch(plugin.url, { method: "POST", headers: { Origin: "https://other.invalid" } })).status, 404);
  fs.writeFileSync(path.join(root, "code.js"), "export function add(x) { return x+2; }\n");
  await tools.call("git_read", { action: "diff", file: "code.js" }, "claude");
  assert.match(fs.readFileSync(path.join(root, "code.js"), "utf8"), /x\+2/);
  tools.close(); await assert.rejects(tools.call("git_read", { action: "status" }, "codex"), /ended/);
});

test("GitHub MCP reads use the current origin and fixed read-only endpoint without publishing", async t => {
  const root = await fixture(t); await git(root, ["remote", "add", "origin", "git@github.com:owner/project.git"]);
  const calls = [];
  const tools = createProjectTools({ cwd: root, git, getToken: async () => "fixture-secret", connectGitHub: (url, headers) => {
    assert.equal(url, "https://api.githubcopilot.com/mcp/readonly"); assert.equal(headers["X-MCP-Readonly"], "true");
    return { initialize: async () => {}, request: async (method, input) => { calls.push({ method, input }); return { content: [{ type: "text", text: "item evidence" }] }; } };
  } }); t.after(() => tools.close());
  await tools.call("github_read", { action: "pr", number: 4 }, "codex");
  await tools.call("github_read", { action: "ci" }, "claude");
  assert.equal(calls[0].input.name, "pull_request_read");
  assert.deepEqual(calls[0].input.arguments, { method: "get", owner: "owner", repo: "project", pullNumber: 4 });
  assert.equal(calls[1].input.arguments.perPage, 5);
  assert.ok(!tools.context("claude").includes("fixture-secret"));
  await assert.rejects(tools.call("github_read", { action: "merge", number: 4 }, "codex"), /read operation/);
  assert.equal(githubRepository("https://user:secret@github.com/owner/repo.git"), null);
  assert.equal(githubRepository("https://github.com.other.invalid/owner/repo.git"), null);
});

test("remote MCP decodes streamed UTF-8 and carries session headers without exposing auth", async () => {
  const requests = []; let count = 0;
  const c = remoteClient("https://example.invalid/mcp", { Authorization: "Bearer fixture" }, { fetch: async (_url, options) => {
    const body = JSON.parse(options.body); requests.push({ body, headers: options.headers }); count++;
    if (!body.id) return new Response(null, { status: 202 });
    const bytes = new TextEncoder().encode("data: " + JSON.stringify({ jsonrpc: "2.0", id: body.id, result: count === 1 ? { protocolVersion: "2025-03-26" } : { content: [{ type: "text", text: "หลักฐาน" }] } }) + "\n\n");
    return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { "content-type": "text/event-stream", "mcp-session-id": "session" } });
  } });
  await c.initialize(); const result = await c.request("tools/call", { name: "read" });
  assert.equal(result.content[0].text, "หลักฐาน"); assert.equal(requests[2].headers["Mcp-Session-Id"], "session");
  assert.equal(requests[1].body.method, "notifications/initialized");
});
