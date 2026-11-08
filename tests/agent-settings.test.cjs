const assert = require("node:assert/strict");
const { test } = require("node:test");
const { effectiveAgentSettings, normalizeAgentSettings, claudeCatalog } = require("../desktop/agent-settings.mjs");

test("model preferences resolve independently and preserve saved project settings", () => {
  const defaults = { codex: { model: "gpt-default", effort: "high" }, claude: { model: "sonnet" } };
  const workspace = { models: { codex: { model: "", effort: "" } } };
  const task = { agentModels: { claude: { model: "haiku", effort: "low" } } };
  assert.deepEqual(effectiveAgentSettings(defaults, workspace, "codex", task), { model: "", effort: "" });
  assert.deepEqual(effectiveAgentSettings(defaults, workspace, "claude", task), task.agentModels.claude);
  assert.deepEqual(effectiveAgentSettings(defaults, workspace, "claude", {}), defaults.claude);
});

test("Claude rejects unsupported effort, Fast, and a fallback alias for the same model", () => {
  const catalog = claudeCatalog({
    fast_mode_disabled_reason: "sdk_opt_in_required",
    available_output_styles: ["default", "Concise"],
    models: [
      { value: "default", resolvedModel: "opus-full", supportsEffort: true, supportedEffortLevels: ["high"], supportsFastMode: true },
      { value: "opus", resolvedModel: "opus-full", supportsEffort: true, supportedEffortLevels: ["high"], supportsFastMode: true },
      { value: "legacy", supportsThinkingOff: true },
    ],
  });
  assert.throws(() => normalizeAgentSettings("claude", { model: "legacy", effort: "high" }, catalog), /valid model, effort/);
  assert.throws(() => normalizeAgentSettings("claude", { model: "legacy", speed: "fast" }, catalog), /Fast mode/);
  assert.throws(() => normalizeAgentSettings("claude", { fallbackModel: "opus" }, catalog), /different/);
  assert.equal(normalizeAgentSettings("claude", { model: "opus", effort: "high", outputStyle: "Concise" }, catalog).effort, "high");
});
