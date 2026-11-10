import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { efforts, normalizeAgentSettings } from "./agent-settings.mjs";

const maxBytes = 512 * 1024;
const fieldNames = { model: "Model", effort: "Effort", speed: "Speed", fallbackModel: "Fallback model", outputStyle: "Output style",
  language: "Response language", maxEffort: "Effort cap", summary: "Reasoning summary" };
const inventoryFields = {
  codex: ["hooks", "mcp_servers", "plugins", "model_providers", "profiles", "sandbox_workspace_write", "shell_environment_policy", "approval_policy", "sandbox_mode"],
  claude: ["hooks", "enabledPlugins", "extraKnownMarketplaces", "permissions", "sandbox", "env", "apiKeyHelper"],
};

export async function readClaudeSettings(filename, root) {
  let file;
  try {
    if (root) {
      filename = await realpath(filename);
      const relative = path.relative(await realpath(root), filename);
      if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("settings path leaves the repository");
    }
    file = await open(filename, "r");
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("unsupported file");
    const data = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(data, 0, data.length, 0);
    if (bytesRead > maxBytes) throw new Error("settings too large");
    const value = JSON.parse(data.toString("utf8", 0, bytesRead).replace(/^\uFEFF/u, ""));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected JSON object");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error("Claude Code settings could not be read. Check that settings.json is a valid JSON object under 512 KB.");
  } finally {
    await file?.close();
  }
}

export async function claudeSettingsLayers(userFile, repo) {
  const layers = [{ label: "User settings", filename: userFile }];
  if (repo) layers.push(
    { label: "Project settings", filename: path.join(repo, ".claude", "settings.json"), root: repo },
    { label: "Project local settings", filename: path.join(repo, ".claude", "settings.local.json"), root: repo },
  );
  const config = Object.create(null);
  const origins = Object.create(null);
  const sources = [];
  for (const { label, filename, root } of layers) {
    try {
      const data = await readClaudeSettings(filename, root);
      if (!data) { sources.push({ label, status: "missing" }); continue; }
      sources.push({ label, status: "read", ...inspectSource("claude", data) });
      for (const key of ["model", "effortLevel", "fastMode", "fastModePerSessionOptIn", "fallbackModel", "outputStyle",
        "language", "maxEffortLevel", "theme", "agentPushNotifEnabled", "inputNeededNotifEnabled"]) {
        if (Object.hasOwn(data, key)) {
          if (key === "maxEffortLevel" && efforts.claude.includes(config[key]) &&
              (!efforts.claude.includes(data[key]) || efforts.claude.indexOf(config[key]) < efforts.claude.indexOf(data[key]))) continue;
          config[key] = data[key];
          origins[key] = label;
        }
      }
    } catch {
      sources.push({ label, status: "unreadable" });
    }
  }
  return { config, origins, sources };
}

export function inspectSource(agent, config) {
  const detected = inventoryFields[agent].filter((key) => Object.hasOwn(config, key) && config[key] != null &&
    (typeof config[key] !== "object" || Object.keys(config[key]).length > 0));
  const hooks = Object.entries(config.hooks ?? {}).flatMap(([event, rules]) =>
    /^[a-z][a-z0-9_]{0,49}$/iu.test(event) && Array.isArray(rules) && rules.length > 0 ? [{ event, groups: rules.length }] : []).slice(0, 40);
  return { detected, hooks };
}

export function importableSettings(agent, config, current = {}, catalog, origins = {}) {
  const keys = agent === "codex"
    ? { model: "model", effort: "model_reasoning_effort", speed: "service_tier", summary: "model_reasoning_summary" }
    : { model: "model", effort: "effortLevel", speed: "fastMode", fallbackModel: "fallbackModel", outputStyle: "outputStyle",
      language: "language", maxEffort: "maxEffortLevel" };
  const source = agent === "codex"
    ? { model: config.model, effort: config.model_reasoning_effort, summary: config.model_reasoning_summary,
      speed: config.service_tier === "fast" || config.service_tier === "priority" ? "fast" : config.service_tier === "standard" ? "standard" : undefined }
    : { model: config.model === "default" ? undefined : config.model, effort: config.effortLevel,
      speed: typeof config.fastMode === "boolean" && (!config.fastMode || config.fastModePerSessionOptIn !== true)
        ? config.fastMode ? "fast" : "standard" : undefined,
      fallbackModel: config.fallbackModel, outputStyle: config.outputStyle, language: config.language, maxEffort: config.maxEffortLevel };
  const omitted = [];
  const rows = [];
  const matches = [];
  if (agent === "claude" && config.fastMode === true && config.fastModePerSessionOptIn === true) omitted.push("Fast requires per-session opt-in");
  const model = typeof source.model === "string" ? source.model : current.model;
  for (const [key, value] of Object.entries(source)) {
    if (value == null || value === "") continue;
    try {
      if (key === "outputStyle" && !catalog?.outputStyles?.includes(value)) throw new Error("Unavailable output style");
      normalizeAgentSettings(agent, key === "model" ? { model: value } : { model, [key]: value }, catalog);
      const row = { id: agent + "." + key, key, label: fieldNames[key], value, current: current[key] ?? "",
        source: origins[keys[key]] };
      (value === current[key] ? matches : rows).push(row);
    } catch { omitted.push(fieldNames[key]); }
  }
  return { rows, matches, omitted, ...inspectSource(agent, config) };
}

export function claudeDeckRows(config, origins, current) {
  const { theme, agentPushNotifEnabled, inputNeededNotifEnabled } = config;
  const rows = [
    ["theme", "Theme", theme === "auto" ? "system" : ["light", "dark"].includes(theme) ? theme : undefined, "theme"],
    ["notifications", "Windows completion alerts", typeof agentPushNotifEnabled === "boolean"
      ? agentPushNotifEnabled ? current.notifications === "always" ? "always" : "background" : "off" : undefined, "agentPushNotifEnabled"],
    ["attentionNotifications", "Windows approval and question alerts", typeof inputNeededNotifEnabled === "boolean"
      ? inputNeededNotifEnabled : undefined, "inputNeededNotifEnabled"],
  ];
  return rows.flatMap(([key, label, value, sourceKey]) => value === undefined ? [] :
    [{ id: "deck." + key, key, label, value, current: current[key], source: origins[sourceKey], sourceKey, target: "deck" }]);
}

export function applySettingsSelection(preview, selection, current, defaults) {
  if (!Array.isArray(selection) || !selection.length || selection.length > 14 || new Set(selection).size !== selection.length) {
    throw new Error("Select at least one valid setting to apply.");
  }
  const remaining = new Set(selection);
  const next = { ...current };
  for (const agent of ["codex", "claude"]) {
    const entry = preview.providers[agent];
    const changes = entry?.rows.filter(({ id }) => remaining.delete(id)) ?? [];
    if (changes.length) {
      const options = { ...(current[agent] ?? defaults?.[agent]), ...Object.fromEntries(changes.map(({ key, value }) => [key, value])) };
      next[agent] = normalizeAgentSettings(agent, options, entry.catalog);
    }
  }
  if (remaining.size) throw new Error("Preview the current settings again before applying.");
  return next;
}
