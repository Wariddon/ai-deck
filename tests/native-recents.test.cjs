const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { listCodexSessions, readCodexSession, listClaudeSessions, readClaudeSession, nativeChatDelivery } = require("../desktop/native-recents.cjs");
const { handoffTarget, listHandoffRefs, sameHandoffTarget, handoffPrompt, nativeHandoffContext } = require("../desktop/recent-handoff.cjs");

test("Claude Recents reuses unchanged metadata but invalidates renamed, rewritten and deleted transcripts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-deck-metadata-cache-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  await fs.mkdir(project);
  const id = "12345678-abcd-4321-abcd-123456789abc", file = path.join(project, id + ".jsonl");
  const text = (title) => JSON.stringify({ type: "user", sessionId: id, cwd: project, customTitle: title,
    message: { content: title } }) + "\n";
  await fs.writeFile(file, text("First"));
  const originalOpen = fs.open;
  let opens = 0;
  t.mock.method(fs, "open", (...args) => { if (args[0] === file) opens++; return originalOpen(...args); });
  const initial = await listClaudeSessions(root);
  assert.equal(initial[0].title, "First"); assert.equal(opens, 1);
  initial[0].title = "Changed in a caller";
  assert.equal((await listClaudeSessions(root))[0].title, "First"); assert.equal(opens, 1);
  const stat = await fs.stat(file);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await fs.writeFile(file, text("Other"));
  await fs.utimes(file, stat.atime, stat.mtime);
  assert.equal((await listClaudeSessions(root))[0].title, "Other"); assert.equal(opens, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(listClaudeSessions(root, { signal: controller.signal }), { name: "AbortError" });
  await fs.unlink(file);
  assert.deepEqual(await listClaudeSessions(root), []);
});

test("native delivery separates a saved question from a reply and ignores old matches", () => {
  const old = { id: "old-question", role: "user", text: "Hello" };
  const attempt = { prompt: old.text, previousIds: new Set([old.id, "old-reply"]) };
  const question = { ...old, id: "new-question" };
  const reply = { id: "new-reply", role: "assistant" };
  const newer = { id: "other-question", role: "user", text: "Other question" };
  assert.equal(nativeChatDelivery(attempt, [old]), undefined);
  assert.equal(nativeChatDelivery(attempt, [question, old]), "saved");
  assert.equal(nativeChatDelivery(attempt, [reply, question, old]), "replied");
  assert.equal(nativeChatDelivery(attempt, [reply, newer, question, old]), "saved");
});

test("handoffs pin an exact saved branch without changing the current checkout", async (t) => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "ai-deck-handoff-ref-"));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  const exec = promisify(execFile);
  const git = async (cwd, args) => (await exec("git", args, { cwd })).stdout;
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["-c", "user.name=AI Deck QA", "-c", "user.email=qa@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--allow-empty", "-m", "Base"]);
  const current = await handoffTarget(git, { repo });
  const remote = "refs/remotes/origin/main";
  await git(repo, ["update-ref", remote, current.commit]);
  await git(repo, ["symbolic-ref", "refs/remotes/origin/HEAD", remote]);
  await git(repo, ["tag", "release"]);
  assert.deepEqual((await listHandoffRefs(git, { repo })).map(({ ref }) => ref).sort(), ["refs/heads/main", remote]);
  const explicit = await handoffTarget(git, { repo }, "refs/heads/main");
  assert.equal(explicit.ref, "refs/heads/main");
  assert.equal(explicit.branch, current.branch);
  assert.equal(sameHandoffTarget(current, explicit), false);
  const first = await handoffTarget(git, { repo }, remote);
  assert.deepEqual(first, { ...current, branch: "origin/main", ref: remote });
  assert.equal(sameHandoffTarget(first, await handoffTarget(git, { repo }, remote)), true);
  for (const invalid of ["HEAD", "--all", "refs/tags/release", remote + "~1", "refs/remotes/origin/HEAD", "refs/remotes/origin"]) {
    await assert.rejects(handoffTarget(git, { repo }, invalid));
  }
  const nested = path.join(repo, "nested");
  await fs.mkdir(nested);
  await assert.rejects(listHandoffRefs(git, { repo: nested }), /repository root/u);
  const newer = (await git(repo, ["-c", "user.name=AI Deck QA", "-c", "user.email=qa@example.invalid", "-c", "commit.gpgsign=false",
    "commit-tree", "HEAD^{tree}", "-p", current.commit, "-m", "Remote update"])).trim();
  await git(repo, ["update-ref", remote, newer]);
  assert.equal(sameHandoffTarget(first, await handoffTarget(git, { repo }, remote)), false);
  assert.deepEqual(await handoffTarget(git, { repo }), current);
});

test("team forks accept either role order and quote selected history from either provider without a source checkout", () => {
  const instruction = "Update the fixture and review the diff.";
  const messages = [{ role: "assistant", text: "Original plan\nWork in the fixture." }];
  for (const [provider, label] of [["codex", "Codex"], ["claude", "Claude Code"]]) {
    const entry = { provider, title: "Chat without Git" };
    for (const mode of ["build-review", "claude-build-review"]) {
      const prompt = handoffPrompt(entry, { mode, instruction, messages });
      assert.ok(prompt.startsWith(instruction));
      assert.ok(prompt.includes(label + ":\n> Original plan\n> Work in the fixture."));
    }
    assert.throws(() => handoffPrompt(entry, { mode: "team", instruction, messages }), /choose a workflow/iu);
    assert.equal(handoffPrompt(entry, { mode: "build-review", messages: [] }), "");
    assert.throws(() => handoffPrompt(entry, { mode: "codex-review", instruction, messages: [] }), /complete messages/iu);
  }
});

test("a team fork keeps selected messages attributed to each source and rejects duplicates or single-agent mixing", () => {
  const claude = { provider: "claude", title: "Claude chat" };
  const codex = { provider: "codex", title: "Codex chat" };
  const first = [{ role: "user", text: "Builder scope" }];
  const second = [{ role: "assistant", text: "Reviewer evidence" }];
  const payload = { mode: "claude-build-review", instruction: "Make the change.", messages: first };
  const prompt = handoffPrompt(claude, payload, { entry: codex, messages: second });
  assert.match(prompt, /Claude Code session: Claude chat\n\nUser:\n> Builder scope/u);
  assert.match(prompt, /Codex session: Codex chat\n\nCodex:\n> Reviewer evidence/u);
  const task = { runHistory: [], nativeHandoff: { attachOnFirstRun: true, sources: [
    { session: claude, messages: first }, { session: codex, messages: second },
  ] } };
  assert.equal(nativeHandoffContext(task), handoffPrompt(claude, { mode: payload.mode, messages: first }, { entry: codex, messages: second }));
  assert.equal(nativeHandoffContext({ ...task, runHistory: [{}] }), "");
  assert.equal(nativeHandoffContext({ runHistory: [{}], nativeHandoff: { chatOnly: true, sources: task.nativeHandoff.sources } }),
    handoffPrompt(claude, { mode: "team-discussion", messages: first }, { entry: codex, messages: second }));
  assert.throws(() => handoffPrompt(claude, payload, { entry: claude, messages: second }), /choose a workflow/iu);
  assert.throws(() => handoffPrompt(claude, { ...payload, mode: "claude" }, { entry: codex, messages: second }), /choose a workflow/iu);
  assert.throws(() => handoffPrompt(claude, { ...payload, messages: Array(32).fill(first[0]) }, { entry: codex, messages: second }), /32 complete messages/u);
});

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
