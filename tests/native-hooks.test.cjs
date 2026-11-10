const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { promises: fs } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createNativeHookEditor, readDocument, sourceList, claudeHookGrant, claudeRunHooks, nativeHookSetup, nativeHookDifferences } = require("../desktop/native-hooks.cjs");
const { safeHookOutput } = require("../desktop/claude-hook-policy.cjs");
const { editHookToml, parseHookToml } = require("../desktop/native-hook-toml.cjs");
const { previewCommand, runCommand } = require("../desktop/native-hook-test.cjs");

async function fixture(t, callbacks = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deck-hooks-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sources = sourceList({ codexHome: path.join(root, "codex"), claudeHome: path.join(root, "claude") });
  const editor = createNativeHookEditor({
    profileDir: root, readCodexState: async () => null,
    replaceExisting: async (temp, target, expected) => {
      assert.equal(createHash("sha256").update(await fs.readFile(target)).digest("hex"), expected);
      await fs.rename(temp, target);
    },
    ...callbacks,
  });
  const state = (source) => editor.snapshot(source);
  const change = async (source, action, row, options) => editor.change(source, undefined, {
    action, rowId: row?.id, options, revision: (await state(source)).revision,
  });
  return { sources, state, change, editor };
}

test("Claude disable survives reload, edits the stored copy and restores beside the original group", async (t) => {
  const { sources: [, , source], state, change } = await fixture(t);
  const sibling = { type: "http", url: "https://example.invalid" };
  await fs.mkdir(source.root);
  await fs.writeFile(source.filename, JSON.stringify({ unrelated: "keep", hooks: { PreToolUse: [{ matcher: "Bash", hooks: [
    { type: "command", command: "old", async: true, statusMessage: "test" }, sibling,
  ] }] } }, null, 2));
  await change(source, "toggle", (await state(source)).rows[0]);
  const paused = await state(source);
  assert.deepEqual(paused.hooks.PreToolUse[0].hooks, [sibling]);
  const stored = paused.rows.find((row) => row.disabled);
  await change(source, "edit", stored, { matcher: "Bash", command: "new", args: ["a b"] });
  assert.deepEqual((await state(source)).hooks, paused.hooks);
  await change(source, "toggle", (await state(source)).rows.find((row) => row.disabled));
  const resumed = await state(source);
  assert.deepEqual(resumed.hooks.PreToolUse[0].hooks, [
    { type: "command", command: "new", async: true, statusMessage: "test", args: ["a b"] }, sibling,
  ]);
  assert.equal(resumed.document.unrelated, "keep");
  assert.equal(resumed.shelf.entries.length, 0);
});

test("hook edits reject a stale file before changing it", async (t) => {
  const { sources: [, , source], state, editor } = await fixture(t);
  const before = await state(source);
  await fs.mkdir(source.root);
  await fs.writeFile(source.filename, '{ "unrelated": 3 }\n');
  await assert.rejects(editor.change(source, undefined, {
    action: "add", options: { event: "SessionStart", command: "echo fixture" }, revision: before.revision,
  }), /changed/iu);
  assert.equal((await readDocument(source)).raw, '{ "unrelated": 3 }\n');
});

test("Claude disable journal recovers when replacement failed", async (t) => {
  const { sources: [, , source], state, change } = await fixture(t, {
    replaceExisting: async () => { throw new Error("locked"); },
  });
  await change(source, "add", null, { event: "Stop", command: "echo fixture" });
  await assert.rejects(change(source, "toggle", (await state(source)).rows[0]), /locked/);
  const recovered = await state(source);
  assert.equal(recovered.rows[0].disabled, undefined);
  assert.equal(recovered.shelf.entries.length, 0);
});

test("editing inline and table hooks in Codex TOML preserves unrelated content", () => {
  const groups = [{ hooks: [{ type: "command", command: 'echo "fixture"', commandWindows: "Write-Output fixture" }] }];
  const unrelated = '# preserve\r\n[another]\r\nvalue = "unchanged"\r\n';
  for (const hook of ["hooks.Stop = []\r\n", "hooks = { Stop = [] }\r\n",
    "[hooks]\r\nStop = []\r\n", "[[hooks.Stop]]\r\n[[hooks.Stop.hooks]]\r\ncommand = 'old'\r\n"]) {
    const after = editHookToml(hook + "\r\n" + unrelated, "Stop", groups);
    assert.ok(after.endsWith(unrelated));
    assert.deepEqual(parseHookToml(after), { hooks: { Stop: groups }, another: { value: "unchanged" } });
  }
});

test("test runner executes an argv hook with real stdin and captures both streams and exit code", async () => {
  const cwd = process.cwd();
  const handler = { type: "command", command: process.execPath, args: ["-e",
    "process.stdin.once('data', data => { console.log(JSON.parse(data).hook_event_name, process.argv[1]); console.error('fixture stderr'); process.exitCode = 7; })",
    "${CLAUDE_PROJECT_DIR}"] };
  const preview = previewCommand({ agent: "claude", event: "SessionStart", handler, cwd });
  const result = await runCommand(preview, preview.input);
  assert.equal(result.code, 7);
  assert.equal(result.stdout.trim(), "SessionStart " + cwd);
  assert.equal(result.stderr.trim(), "fixture stderr");
  assert.throws(() => runCommand(preview, "[]"), /JSON object/);
});

test("cancelling a hook test stops the spawned script", async () => {
  const controller = new AbortController();
  const handler = { type: "command", command: process.execPath, args: ["-e", "setTimeout(() => console.log('finished'), 10000)"] };
  const preview = previewCommand({ agent: "claude", event: "Stop", handler, cwd: process.cwd() });
  const running = runCommand(preview, preview.input, controller.signal);
  controller.abort();
  const result = await running;
  assert.equal(result.reason, "cancelled");
  assert.equal(result.stdout, "");
  assert.ok(result.durationMs < 4000);
});

test("Claude Send includes user scripts and exact reviewed project definitions, without unrelated settings", async (t) => {
  const { sources: [, , user] } = await fixture(t);
  const project = { ...user, id: "claude-project", filename: path.join(user.root, "project.json") };
  const local = { ...user, id: "claude-local", filename: path.join(user.root, "local.json") };
  const hook = (command) => ({ hooks: [{ type: "command", command }] });
  await fs.mkdir(user.root);
  const data = { hooks: { Stop: [hook("reviewed"), hook("old")] }, permissions: { defaultMode: "bypassPermissions" } };
  const grant = claudeHookGrant(data);
  const save = (source, value) => fs.writeFile(source.filename, JSON.stringify(value));
  await save(user, { hooks: { Stop: [hook("user"), { hooks: [{ type: "http", url: "https://example.invalid" }] }] } });
  await save(project, { ...data, hooks: { Stop: [hook("reviewed"), hook("changed")] } });
  await save(local, { disableAllHooks: true, hooks: { Stop: [hook("unreviewed")] } });
  const run = () => claudeRunHooks([user, project, local], { [project.id]: grant }, { specs: [] });
  const first = await run();
  assert.deepEqual(first.settings, { hooks: Object.assign(Object.create(null), { Stop: [hook("user"), hook("reviewed")] }) });
  assert.equal(first.skipped, 2);
  await save(user, { disableAllHooks: true, hooks: { Stop: [hook("user")] } });
  assert.equal((await run()).settings, null);
});

test("Claude native permission hooks retain denials and cannot grant or rewrite a tool call", () => {
  const pre = (permissionDecision) => JSON.parse(safeHookOutput("PreToolUse", JSON.stringify({
    decision: "approve", hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision,
      updatedInput: { file_path: "outside" }, additionalContext: "context" },
  })));
  assert.deepEqual(pre("allow"), { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "context" } });
  assert.equal(pre("deny").hookSpecificOutput.permissionDecision, "deny");
  const request = JSON.parse(safeHookOutput("PermissionRequest", JSON.stringify({
    hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow", updatedPermissions: [{}] } },
  })));
  assert.deepEqual(request, { hookSpecificOutput: { hookEventName: "PermissionRequest" } });
});

test("approval snapshots flag native hook event and trust changes without exposing script text", async (t) => {
  const { sources } = await fixture(t);
  const [, codex, claude] = sources;
  await fs.mkdir(codex.root);
  await fs.mkdir(claude.root);
  const saveCodex = (model, trust) => fs.writeFile(codex.filename, 'model = "' + model + '"\n[hooks.state.demo]\nenabled = ' + trust);
  const saveClaude = (command) => fs.writeFile(claude.filename, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }));
  await saveCodex("model-a", true);
  await saveClaude("first private command");
  const before = nativeHookSetup(sources);
  await saveCodex("model-b", true);
  assert.deepEqual(nativeHookDifferences(before, nativeHookSetup(sources)), []);
  await saveCodex("model-b", false);
  await saveClaude("second private command");
  const changes = nativeHookDifferences(before, nativeHookSetup(sources));
  assert.equal(changes.length, 2);
  assert.match(changes[0], /Trust and enable state/);
  assert.match(changes[1], /Stop/);
  assert.doesNotMatch(JSON.stringify(changes), /private command/);
});
