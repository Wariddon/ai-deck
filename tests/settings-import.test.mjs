import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importableSettings, applySettingsSelection, claudeDeckRows, claudeSettingsLayers, readClaudeSettings } from "../desktop/settings-import.mjs";
import { deckPreferenceChange, defaultDeckPreferences, normalizeDeckPreferences } from "../desktop/deck-preferences.mjs";

test("provider preview exposes approved model fields and only the names of sensitive groups", () => {
  const codex = importableSettings("codex", {
    model: "gpt-fixture", model_reasoning_effort: "high", service_tier: "fast",
    mcp_servers: { fixture: { url: "https://example.com/private-token" } },
    hooks: { Stop: [{ command: "private-command" }] },
  });
  const claude = importableSettings("claude", {
    model: "sonnet", effortLevel: "medium", fastMode: false, fallbackModel: "haiku",
    outputStyle: "private-style", env: { API_KEY: "private-key" }, apiKeyHelper: "private-helper",
  });
  assert.deepEqual(codex.rows.map(({ id }) => id), ["codex.model", "codex.effort"]);
  assert.deepEqual(codex.omitted, ["Speed"]);
  assert.deepEqual(codex.detected, ["hooks", "mcp_servers"]);
  assert.deepEqual(claude.rows.map(({ id }) => id), ["claude.model", "claude.effort", "claude.speed", "claude.fallbackModel"]);
  assert.deepEqual(claude.omitted, ["Output style"]);
  assert.deepEqual(claude.detected, ["env", "apiKeyHelper"]);
  assert.doesNotMatch(JSON.stringify([codex, claude]), /private-/u);
});

test("applying both providers changes only selected defaults and checks incompatible combinations", () => {
  const current = { codex: { model: "old", effort: "medium", speed: "" }, claude: { model: "sonnet", effort: "medium" } };
  const catalog = { models: [{ value: "new", efforts: ["high"], fast: true }] };
  const preview = { providers: {
    codex: { ...importableSettings("codex", { model: "new", model_reasoning_effort: "high", service_tier: "fast" }, current.codex, catalog), catalog },
    claude: importableSettings("claude", { model: "opus", effortLevel: "high" }, current.claude),
  } };
  assert.throws(() => applySettingsSelection(preview, ["codex.model"], current), /valid model/u);
  assert.throws(() => applySettingsSelection(preview, ["codex.hooks"], current), /Preview/u);
  const next = applySettingsSelection(preview, ["codex.model", "codex.effort", "claude.effort"], current);
  assert.deepEqual(next.codex, { model: "new", effort: "high", speed: "" });
  assert.equal(next.claude.model, "sonnet");
  assert.equal(next.claude.effort, "high");
  assert.equal(current.codex.model, "old");
});

test("missing and malformed Claude settings do not leak file contents or JSON errors", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "deck-settings-test-"));
  const filename = path.join(folder, "settings.json");
  try {
    assert.equal(await readClaudeSettings(filename), null);
    await writeFile(filename, '\uFEFF{"model":"sonnet"}');
    assert.deepEqual(await readClaudeSettings(filename), { model: "sonnet" });
    await writeFile(filename, '{"secret": "private-value"');
    await assert.rejects(readClaudeSettings(filename), { message: "Claude Code settings could not be read. Check that settings.json is a valid JSON object under 512 KB." });
  } finally {
    await rm(filename, { force: true });
    await rmdir(folder);
  }
});

test("older profiles get voice and appearance defaults and invalid IPC options fail", () => {
  assert.deepEqual(normalizeDeckPreferences(), defaultDeckPreferences);
  assert.equal(normalizeDeckPreferences().sendOnEnter, true);
  assert.equal(normalizeDeckPreferences({ sendOnEnter: false }).sendOnEnter, false);
  const changed = deckPreferenceChange(defaultDeckPreferences, { key: "voiceLanguage", value: "en" });
  assert.deepEqual(normalizeDeckPreferences(changed), { ...defaultDeckPreferences, voiceLanguage: "en" });
  assert.throws(() => deckPreferenceChange(changed, { key: "notifications", value: "sometimes" }), /supported/u);
});

test("Claude project layers preserve provenance and the lowest effort cap without copying hook commands", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "deck-project-settings-"));
  const project = path.join(folder, ".claude");
  const user = path.join(folder, "user-settings.json");
  const shared = path.join(project, "settings.json");
  const local = path.join(project, "settings.local.json");
  try {
    await mkdir(project);
    await writeFile(user, JSON.stringify({ model: "sonnet", language: "English", maxEffortLevel: "medium", agentPushNotifEnabled: true }));
    await writeFile(shared, JSON.stringify({ language: "ไทย", hooks: { Stop: [{ hooks: [{ command: "private-command" }] }] } }));
    await writeFile(local, JSON.stringify({ maxEffortLevel: "high", inputNeededNotifEnabled: true }));
    const { config, origins, sources } = await claudeSettingsLayers(user, folder);
    const result = importableSettings("claude", config, {}, undefined, origins);
    assert.equal(result.rows.find(({ key }) => key === "language").source, "Project settings");
    assert.equal(result.rows.find(({ key }) => key === "language").value, "ไทย");
    assert.equal(result.rows.find(({ key }) => key === "maxEffort").value, "medium");
    assert.deepEqual(sources[1].hooks, [{ event: "Stop", groups: 1 }]);
    assert.doesNotMatch(JSON.stringify({ config, sources }), /private-command/u);
    assert.deepEqual(claudeDeckRows(config, origins, defaultDeckPreferences).map(({ id, value }) => [id, value]),
      [["deck.notifications", "always"], ["deck.attentionNotifications", true]]);
    assert.deepEqual(claudeDeckRows(config, origins, { ...defaultDeckPreferences, notifications: "off" }).map(({ id, value }) => [id, value]),
      [["deck.notifications", "background"], ["deck.attentionNotifications", true]]);
    const applied = applySettingsSelection({ providers: { claude: result } }, ["claude.language"], {}, { claude: { model: "opus", effort: "low" } });
    assert.deepEqual(applied.claude, { model: "opus", effort: "low", speed: "", fallbackModel: "", outputStyle: "", language: "ไทย" });
  } finally {
    for (const file of [user, shared, local]) await rm(file, { force: true });
    await rmdir(project);
    await rmdir(folder);
  }
});

test("Claude per-session Fast settings stay explicit and language and cap reach the CLI", async () => {
  const { claudeArguments } = (await import("../desktop/engines.cjs")).default;
  const settings = importableSettings("claude", { fastMode: true, fastModePerSessionOptIn: true, language: "ไทย", maxEffortLevel: "medium" });
  assert.deepEqual(settings.omitted, ["Fast requires per-session opt-in"]);
  const applied = applySettingsSelection({ providers: { claude: settings } }, ["claude.language", "claude.maxEffort"], {});
  const args = claudeArguments([], null, applied.claude);
  assert.deepEqual(JSON.parse(args[args.indexOf("--settings") + 1]), { language: "ไทย", maxEffortLevel: "medium" });
});
