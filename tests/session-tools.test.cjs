const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { archiveDirectory, changeClaudeTranscript } = require("../desktop/claude-transcripts.cjs");
const { listClaudeSessions } = require("../desktop/native-recents.cjs");
const { previewLink, addressAllowed } = require("../desktop/link-preview.cjs");
const { ensureTasks, newTask, selectedTask, workspaceView } = require("../desktop/tasks.cjs");
const { confirmedSessionSelection, sessionKey } = require("../desktop/session-selection.mjs");

test("bulk deletion requires confirmation and binds each selection to its source", () => {
  const codex = { provider: "codex", id: "same-id" };
  const claude = { provider: "claude", id: "same-id" };
  const deck = { repo: "C:/fixture", id: "same-id" };
  assert.throws(() => confirmedSessionSelection({ entries: [codex] }), /Confirm/u);
  assert.throws(() => confirmedSessionSelection({ confirmed: true, entries: [] }), /Confirm/u);
  assert.throws(() => confirmedSessionSelection({ confirmed: true, entries: [codex, { provider: "other", id: "invalid" }] }), /valid chats/u);
  assert.throws(() => confirmedSessionSelection({ confirmed: true, entries: [{ ...codex, repo: deck.repo }] }), /valid chats/u);
  const selected = confirmedSessionSelection({ confirmed: true, entries: [codex, claude, deck, { ...codex, title: "ignored" }] });
  assert.deepEqual(selected, [codex, claude, deck]);
  assert.equal(new Set(selected.map(sessionKey)).size, 3);
});

test("Claude local transcript lifecycle preserves original bytes and refuses an occupied restore destination", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-deck-session-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const id = "1d1f1874-e0c5-413b-af94-3c12a310f380";
  const folder = path.join(root, "fixture");
  await fs.mkdir(folder);
  const file = path.join(folder, id + ".jsonl");
  const baseline = JSON.stringify({ type: "user", sessionId: id, cwd: folder, message: { content: "Fixture message" } });
  await fs.writeFile(file, baseline);
  const idle = async () => {};
  let entry = (await listClaudeSessions(root))[0];
  await assert.rejects(changeClaudeTranscript(root, entry, "rename", "Blocked rename", async () => { throw new Error("Claude is open"); }), /Claude is open/u);
  assert.equal(await fs.readFile(file, "utf8"), baseline);
  entry = await changeClaudeTranscript(root, entry, "rename", "Fixture renamed", idle);
  assert.ok((await fs.readFile(file, "utf8")).startsWith(baseline + "\n"));
  assert.equal((await listClaudeSessions(root))[0].title, "Fixture renamed");
  entry = await changeClaudeTranscript(root, entry, "archive", undefined, idle);
  assert.equal((await listClaudeSessions(root)).length, 0);
  assert.equal((await listClaudeSessions(archiveDirectory(root)))[0].id, id);
  await fs.writeFile(file, "A different transcript");
  await assert.rejects(changeClaudeTranscript(root, entry, "restore", undefined, idle), { code: "EEXIST" });
  assert.equal(await fs.readFile(file, "utf8"), "A different transcript");
  await fs.unlink(file);
  entry = await changeClaudeTranscript(root, entry, "restore", undefined, idle);
  assert.equal(entry.file, file);
  assert.equal(await changeClaudeTranscript(root, entry, "delete", undefined, idle), null);
  assert.deepEqual(await listClaudeSessions(root), []);
});

test("an archived task stays in history and an active task is selected", () => {
  const task = { ...newTask(), title: "Archived fixture", archivedAt: "2026-11-09T00:00:00.000Z" };
  const workspace = ensureTasks({ tasks: [task], currentTask: task.id });
  assert.notEqual(selectedTask(workspace).id, task.id);
  assert.equal(workspaceView(workspace).tasks.find(({ id }) => id === task.id).archived, true);
});

test("link preview fetches explicitly selected localhost text and blocks unsafe targets", async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") { response.writeHead(302, { Location: "http://10.0.0.1/" }); response.end(); return; }
    if (request.url === "/large") { response.writeHead(200, { "Content-Type": "text/plain" }); response.end("x".repeat(513 * 1024)); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<main>Fixture URL content</main>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const url = "http://127.0.0.1:" + server.address().port;
  assert.deepEqual(await previewLink(url + "/#anchor"), { url: url + "/", html: true, body: "<main>Fixture URL content</main>" });
  await assert.rejects(previewLink(url + "/redirect"), /different origin/u);
  await assert.rejects(previewLink(url + "/large"), /512 KB/u);
  await assert.rejects(previewLink("http://10.0.0.1/"), /public or point directly/u);
  await assert.rejects(previewLink("https://example.invalid", async () => [{ address: "169.254.169.254", family: 4 }]), /public or point directly/u);
  assert.equal(addressAllowed("::ffff:127.0.0.1"), false);
  assert.equal(addressAllowed("2606:4700:4700::1111"), true);
});

test("link preview can time out before a stalled DNS lookup finishes", { timeout: 1000 }, async () => {
  const deadline = new AbortController();
  const preview = previewLink("https://example.invalid", async () => new Promise(() => {}), deadline.signal);
  deadline.abort();
  await assert.rejects(preview, /link preview timed out/u);
});
