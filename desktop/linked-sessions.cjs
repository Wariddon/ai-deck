const { createHash } = require("node:crypto");
const { sameHandoffTarget } = require("./recent-handoff.cjs");

const linkedModes = ["codex-review", "codex", "claude", "claude-write"];
const linkedAgent = (mode) => mode.startsWith("codex") ? "codex" : "claude";
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function linkedResume(link, agent) {
  const id = link.refs[agent];
  if (id) return { id, fork: false };
  if (link.source.provider === agent) return { id: link.source.id, fork: link.folderMode === "copy" };
  return { id: undefined, fork: false };
}

function linkedContext(link, agent, snapshots) {
  const peer = agent === "codex" ? "claude" : "codex";
  const source = snapshots[peer];
  if (!source?.messages.length || source.revision === link.delivered?.[agent]?.revision) return null;
  const last = link.delivered?.[agent]?.anchor;
  const index = last ? source.messages.findIndex(({ id }) => id === last) : -1;
  const messages = (index >= 0 ? source.messages.slice(0, index) : source.messages).slice(0, 8).reverse();
  if (!messages.length) return null;
  const provider = peer === "codex" ? "Codex" : "Claude Code";
  const text = messages.map(({ role, text }) => (role === "user" ? "User" : provider) + "\n" +
    text.slice(0, 1000).split(/\r?\n/u).map((line) => "> " + line).join("\n")).join("\n\n");
  return { provider: peer, revision: source.revision, anchor: source.messages[0].id, count: messages.length, text };
}

function sameLinkedTarget(checked, current) {
  return sameHandoffTarget(checked, current) && checked.cwd === current.cwd &&
    checked.status === current.status && checked.stamp === current.stamp;
}

function commandSummary(check) {
  return check.subject + " · " + check.status + (Number.isInteger(check.exitCode) ? " · exit " + check.exitCode : "");
}

function linkedEvidence(runs) {
  return runs.slice(-24).flatMap((run) => (run.evidence ?? []).filter((item) => item.kind === "command" && item.subject)
    .map((item) => ({ ...item, runId: run.id, selectionId: [run.id, item.agent, item.id].join(":") }))).reverse().slice(0, 60);
}

function linkedReceipts(runs, target) {
  return runs.filter((run) => run.linkedHandoff && Object.hasOwn(run.agents, target)).slice(-8).reverse()
    .map((run) => ({ runId: run.id, at: run.finishedAt ?? run.startedAt, status: run.agents[target].status, ...run.linkedHandoff }));
}

function nativeResumeCommand({ cwd, exe, agent, id }) {
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  const flag = agent === "codex" ? " resume " : " --resume ";
  return "Set-Location -LiteralPath " + quote(cwd) + " -ErrorAction Stop\r\n& " + quote(exe) + flag + quote(id);
}

module.exports = { linkedModes, linkedAgent, linkedResume, linkedContext, sameLinkedTarget, digest,
  commandSummary, linkedEvidence, linkedReceipts, nativeResumeCommand };
