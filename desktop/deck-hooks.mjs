export const hookActions = {
  status: { label: "Git status", args: ["status", "--short", "--branch", "--untracked-files=normal"] },
  whitespace: { label: "Git diff --check", args: ["diff", "--no-ext-diff", "--no-textconv", "--check", "HEAD", "--"] },
};

const hookPhases = ["before", "after"];
const hookAgents = ["both", "codex", "claude"];

export function validateDeckHooks(input) {
  if (!Array.isArray(input) || input.length > 8) throw new Error("Save up to eight Git hooks per project.");
  const rows = [];
  for (const row of input) {
    if (!Object.hasOwn(hookActions, row?.action) || !hookPhases.includes(row.phase) ||
        !hookAgents.includes(row.agent) || typeof row.enabled !== "boolean") throw new Error("Choose a valid hook event, provider and Git check.");
    if (rows.some((other) => other.action === row.action && other.phase === row.phase && other.agent === row.agent)) {
      throw new Error("This Git check is already configured for that event and provider.");
    }
    rows.push({ action: row.action, phase: row.phase, agent: row.agent, enabled: row.enabled });
  }
  return rows;
}

export async function executeDeckHook(exe, cwd, action, capture) {
  const hook = hookActions[action];
  if (!hook || !Object.hasOwn(hookActions, action)) throw new Error("Choose a supported Git check.");
  const result = await capture(exe, ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=NUL", ...hook.args],
    { cwd, timeout: 8000, limit: 10 * 1024 });
  return { label: hook.label, code: result.code, output: (result.stdout.trim() || result.stderr.trim()).slice(0, 1800) };
}
