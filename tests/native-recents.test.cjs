const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { listCodexSessions, readCodexSession, listClaudeSessions, readClaudeSession } = require("../desktop/native-recents.cjs");

test("Codex history lists named sessions and previews stored text without resuming a thread", async () => {
  const calls = [];
  const engine = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/list") return { data: [
        { id: "session", name: "Saved name", preview: "First prompt", cwd: "C:\\work\\project", updatedAt: 100 },
        { id: "ephemeral", ephemeral: true },
      ] };
      if (method === "thread/turns/list" && params.cursor === "earlier") return { data: [
        { id: "old", items: [{ id: "reply", type: "agentMessage", text: "Older reply" }] },
      ] };
      if (method === "thread/turns/list") return { nextCursor: "earlier", data: [
        { id: "new", items: [{ id: "reply", type: "agentMessage", text: "Latest reply" }] },
        { items: [
          { type: "userMessage", content: [{ type: "image", url: "secret" }, { type: "text", text: "Original request" }] },
          { type: "agentMessage", phase: "commentary", text: "Checking" },
          { type: "commandExecution", aggregatedOutput: "tool output" },
        ] },
      ] };
      assert.fail("Unexpected Codex call " + method);
    },
  };
  assert.deepEqual(await listCodexSessions(engine), [
    { provider: "codex", id: "session", title: "Saved name", project: "project", updatedAt: 100000, cwd: "C:\\work\\project", branch: undefined },
  ]);
  const page = await readCodexSession(engine, "session");
  assert.deepEqual(page.messages.map(({ role, text }) => [role, text]), [
    ["assistant", "Latest reply"], ["user", "Original request"],
  ]);
  const earlier = await readCodexSession(engine, "session", page.cursor);
  assert.equal(earlier.messages[0].text, "Older reply");
  assert.notEqual(earlier.messages[0].id, page.messages[0].id);
  assert.equal(earlier.cursor, null);
  assert.equal(calls[0].params.archived, false);
  assert.ok(calls[0].params.sourceKinds.includes("vscode"));
  assert.equal(calls[1].params.threadId, "session");
});

test("Claude Code recents use local transcripts across projects and preview only conversation text", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-deck-native-recents-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(await listClaudeSessions(path.join(root, "missing")), []);
  const older = "11111111-1111-1111-1111-111111111111";
  const newer = "22222222-2222-2222-2222-222222222222";
  const make = async (project, sessionId, records, time) => {
    const dir = path.join(root, project);
    await fs.mkdir(dir);
    const file = path.join(dir, sessionId + ".jsonl");
    await fs.writeFile(file, records.map((record) => JSON.stringify({ sessionId, cwd: "C:/repos/" + project, ...record })).join("\n") + "\n{incomplete");
    await fs.utimes(file, time, time);
    return file;
  };
  const record = (type, content, extra) => ({ type, message: { content }, ...extra });
  await make("older", older, [record("user", "Original title\nadditional prompt line")], new Date(100000));
  const file = await make("newer", newer, [
    record("user", "<local-command-stdout>ignore this</local-command-stdout>"),
    record("user", "Real request"),
    record("assistant", [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "Real reply" }]),
    record("user", [{ type: "tool_result", content: "hidden" }]),
    record("assistant", "Side thread", { isSidechain: true }),
    record("assistant", "Different session", { sessionId: older }),
    { type: "custom-title", customTitle: "ชื่อแชตที่ตั้งไว้" },
  ], new Date(200000));
  await fs.writeFile(path.join(root, "newer", "credentials.jsonl"), "{}");
  const rows = await listClaudeSessions(root);
  assert.deepEqual(rows.map(({ id, title, project }) => [id, title, project]), [
    [newer, "ชื่อแชตที่ตั้งไว้", "newer"], [older, "Original title", "older"],
  ]);
  const page = await readClaudeSession(root, rows[0]);
  assert.deepEqual(page.messages.map(({ role, text }) => [role, text]), [
    ["assistant", "Real reply"], ["user", "Real request"],
  ]);
  assert.equal(page.cursor, null);
  await assert.rejects(readClaudeSession(path.join(root, "older"), { id: newer, file }), /not a local/);
});

test("Claude history pages keep byte boundaries, order and old messages across a large tool record", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-deck-native-pages-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const id = "33333333-3333-3333-3333-333333333333";
  const folder = path.join(root, "project");
  await fs.mkdir(folder);
  const file = path.join(folder, id + ".jsonl");
  const record = (type, content) => JSON.stringify({ sessionId: id, type, message: { content } });
  const messages = Array.from({ length: 65 }, (_, index) => "ข้อความ " + index);
  const transcript = [
    ...messages.slice(0, 18).map((text) => record("user", text)),
    record("user", [{ type: "tool_result", content: "x".repeat(3 * 1024 * 1024) }]),
    ...messages.slice(18).map((text) => record("assistant", text)),
  ];
  await fs.writeFile(file, transcript.join("\r\n") + "\r\n");
  const loaded = [];
  let cursor;
  for (let index = 0; index < 8; index++) {
    const page = await readClaudeSession(root, { id, file }, cursor);
    loaded.push(...page.messages);
    cursor = page.cursor;
    if (!cursor) break;
  }
  assert.equal(cursor, null);
  assert.deepEqual(loaded.map(({ text }) => text), [...messages].reverse());
  assert.equal(new Set(loaded.map(({ id }) => id)).size, messages.length);
});
