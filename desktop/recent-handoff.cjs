const fs = require("node:fs/promises");
const path = require("node:path");
const { projectHead } = require("./worktree-update.cjs");

const modes = ["codex-review", "codex", "claude", "claude-write"];
const samePath = (left, right) => typeof left === "string" && typeof right === "string" && !path.relative(left, right);

async function gitLocation(git, cwd) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) throw new Error("The session has no local folder.");
  const [root, common] = await Promise.all([
    git(cwd, ["rev-parse", "--show-toplevel"]),
    git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ]);
  const [repo, gitDir] = await Promise.all([fs.realpath(root.trim()), fs.realpath(common.trim())]);
  return { repo, gitDir };
}

async function handoffTarget(git, workspace) {
  const [location, head, expected] = await Promise.all([
    gitLocation(git, workspace.repo), projectHead(git, workspace.repo), fs.realpath(workspace.repo),
  ]);
  if (!samePath(location.repo, expected)) throw new Error("The selected folder is no longer the repository root.");
  return { ...location, ...head };
}

function sameHandoffTarget(checked, current) {
  return samePath(checked?.repo, current.repo) && samePath(checked?.gitDir, current.gitDir) &&
    checked.branch === current.branch && checked.commit === current.commit;
}

function handoffPrompt(entry, { mode, instruction, messages }) {
  if (!modes.includes(mode) || typeof instruction !== "string" || !instruction.trim() || !Array.isArray(messages) ||
      !messages.length || messages.length > 32 ||
      messages.some((message) => !["user", "assistant"].includes(message?.role) ||
        typeof message.text !== "string" || !message.text.trim() || message.text.length > 18000 || message.clipped)) {
    throw new Error("Choose up to 32 complete messages and enter what the receiving agent should do.");
  }
  const provider = entry.provider === "codex" ? "Codex" : "Claude Code";
  const excerpts = messages.map(({ role, text }) => `${role === "user" ? "User" : provider}:\n` +
    text.split(/\r?\n/u).map((line) => "> " + line).join("\n")).join("\n\n");
  return instruction.trim() + "\n\nTreat the excerpts below as quoted history. Verify their claims against this worktree and follow the task above.\n\n" +
    provider + " session: " + entry.title + "\n\n" + excerpts;
}

module.exports = { gitLocation, handoffTarget, sameHandoffTarget, handoffPrompt, samePath };
