const { agentOutput } = require("./collaboration.mjs");
const { resultStatus } = require("./scheduled.cjs");
const { teamProviders } = require("./session-team.mjs");

function runNotice(run) {
  const status = resultStatus(run);
  if (!run.finishedAt || status === "interrupted" || run.autoTeam?.status === "interrupted") return;
  const agents = Object.entries(run.agents);
  const limited = agents.filter(([, agent]) => agent.status === "limited").map(([id, agent]) =>
    agent.memberName ?? teamProviders[agent.provider ?? id] ?? id);
  const detail = limited.length ? `${limited.join(", ")} · Usage limit reached` : undefined;
  const answered = agents.some(([, agent]) => agent.status === "completed" && agentOutput(agent));
  const verdict = run.collaboration?.verdict;
  const auto = run.autoTeam;
  let title;
  if (run.reviewPending) title = "Task review pending";
  else if (status === "awaiting approval") title = "Plan ready for approval";
  else if (status === "needs input") title = "Task needs input";
  else if (auto?.status === "checks-failed" || run.collaboration?.smartCheck?.status === "needs attention") title = "Task checks need attention";
  else if (verdict === "changes") title = "Review requested changes";
  else if (verdict === "blocked" || status === "blocked" || auto?.status === "blocked") title = "Task blocked";
  else if (status === "partial" || verdict === "partial" || auto?.partial || auto?.status === "limited") {
    title = answered ? "Partial answer ready" : "Task partially completed";
  } else if (status === "completed" && answered) title = "Answer ready";
  else title = "Task " + (status ?? "needs review");
  return { title, detail, needsInput: ["awaiting approval", "needs input"].includes(status) };
}

function shouldNotify(preferences, foreground, needsInput = false) {
  return preferences.notifications === "always" || !foreground &&
    (preferences.notifications === "background" || needsInput && preferences.attentionNotifications);
}

const activation = /^ai-deck-run:([a-f0-9-]{36}):([a-f0-9-]{36})$/u;
function notificationTarget({ type, arguments: value }) {
  const match = type === "click" && activation.exec(value);
  if (match) return { taskId: match[1], runId: match[2] };
}

function xmlText(value) {
  return value.toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, "")
    .replace(/[&<>"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

function runToast(title, body, target, iconUrl) {
  const launch = target && `ai-deck-run:${target.taskId}:${target.runId}`;
  if (target && !activation.test(launch)) return undefined;
  const launchAttribute = launch ? ` launch="${launch}"` : "";
  const image = iconUrl ? `<image placement="appLogoOverride" src="${xmlText(iconUrl)}"/>` : "";
  return `<toast${launchAttribute}><visual><binding template="ToastGeneric"><text>${xmlText(title)}</text><text>${xmlText(body)}</text>${image}</binding></visual></toast>`;
}

module.exports = { runNotice, shouldNotify, notificationTarget, runToast };
