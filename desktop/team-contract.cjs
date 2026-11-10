const { validScope, scopeIncludes, overlappingScope } = require("./team-paths.mjs");

function readAssignment(value, writes) {
  if (!value || typeof value.task !== "string" || !value.task.trim() || value.task.length > 1800) {
    throw new Error("Give each agent a concrete assignment.");
  }
  const paths = value.paths;
  if (!Array.isArray(paths) || paths.length > 24 || writes !== (paths.length > 0) || !paths.every(validScope)) {
    throw new Error("Give each writer exact repository paths. Use a trailing slash for directories. Reviewers have no write paths.");
  }
  if (!Array.isArray(value.acceptance) || !value.acceptance.length || value.acceptance.length > 8 ||
      value.acceptance.some((item) => typeof item !== "string" || !item.trim() || item.length > 400)) {
    throw new Error("Give each agent at least one concrete acceptance criterion.");
  }
  return { task: value.task.trim(), paths: [...new Set(paths)], acceptance: value.acceptance.map((item) => item.trim()) };
}

function validateAssignments(value, writers) {
  const assignments = {
    codex: readAssignment(value?.codex, writers.includes("codex")),
    claude: readAssignment(value?.claude, writers.includes("claude")),
  };
  const overlap = overlappingScope(assignments.codex.paths, assignments.claude.paths);
  if (overlap) throw new Error("Both assignments claim " + overlap + ". Use separate paths or one writer.");
  return assignments;
}

function validateRequiredChecks(input) {
  if (!Array.isArray(input) || input.length > 6) throw new Error("Save up to six required checks.");
  const checks = input.map((value) => {
    const { name, command, owner = "both", shareResult } = value ?? {};
    if (typeof name !== "string" || !name.trim() || name.length > 80 ||
        typeof command !== "string" || !command.trim() || command.length > 2000 || /[\r\n\0]/u.test(command) ||
        !["both", "codex", "claude"].includes(owner)) throw new Error("Give each check a name and a one-line PowerShell command.");
    return { name: name.trim(), command: command.trim(), owner, ...(shareResult === true && { shareResult: true }) };
  });
  if (new Set(checks.map(({ name }) => name.toLowerCase())).size !== checks.length) throw new Error("Use a unique name for each check.");
  return checks;
}

function sharedCheckSource(checks, results, index) {
  const check = checks[index];
  if (!check.shareResult || !index) return undefined;
  const previous = checks[index - 1];
  const result = results[index - 1];
  if (!previous.shareResult || previous.command !== check.command || !["passed", "failed"].includes(result?.status)) return undefined;
  return result.sharedFrom ?? result.name;
}

function formatRequiredChecks(checks) {
  return checks.map(({ name, status, code, output, sharedFrom }) =>
    [name + " · " + status + (Number.isInteger(code) ? " · exit " + code : "") +
      (sharedFrom ? " · Shared result from " + sharedFrom : ""), sharedFrom ? "" : output].filter(Boolean).join("\n")).join("\n\n");
}

module.exports = { validateAssignments, validateRequiredChecks, sharedCheckSource, formatRequiredChecks, scopeIncludes };
