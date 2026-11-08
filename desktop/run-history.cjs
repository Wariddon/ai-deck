const { randomUUID } = require("node:crypto");
const { planPair, unresolvedTeamPlan } = require("./collaboration.mjs");

const activeStatuses = new Set(["queued", "preparing", "running"]);

function evidenceText(value) {
  if (typeof value !== "string") return "";
  if (/\b(?:bearer|authorization|(?:api[_-]?key|token|password|secret)\s*(?:=|:)|--(?:api[_-]?key|password|token)\b)/iu.test(value)) {
    return "Text hidden because it may contain credentials.";
  }
  return value.trim().slice(0, 1000);
}

function recordEvidence(run, agent, event) {
  const approval = event.type === "approval-decision";
  const evidence = {
    id: event.key ?? randomUUID(), agent, kind: approval ? "approval" : "command", at: new Date().toISOString(),
    ...(approval ? { title: evidenceText(event.title), subject: evidenceText(event.subject), status: event.accepted ? "allowed" : "declined" }
      : { subject: evidenceText(event.command), status: event.status,
        ...(Number.isSafeInteger(event.exitCode) && { exitCode: event.exitCode }) }),
  };
  run.evidence = [...(run.evidence ?? []).filter((item) => item.agent !== agent || item.id !== evidence.id || item.kind !== evidence.kind), evidence].slice(-60);
}

function newRun(mode, prompt, agents, lowMemory = false) {
  return {
    id: randomUUID(), mode, prompt, startedAt: new Date().toISOString(), finishedAt: null,
    timeline: [], ...(lowMemory && agents.length > 1 && { lowMemory: true }),
    agents: Object.fromEntries(agents.map((agent, index) => [agent, {
      status: (index > 0 && (lowMemory || mode === "build-review" || mode === "claude-build-review" || planPair(mode))) ? "queued" : "preparing",
      messages: [],
    }])),
  };
}

function recordEvent(run, agent, event) {
  const entry = run.agents[agent];
  if (!entry) return;
  if (event.type === "approval-decision" || event.type === "command-result") recordEvidence(run, agent, event);
  if (event.type === "status") entry.status = event.status;
  if (event.type === "run-model") entry.reportedModel = event.model;
  if (event.type === "handoff") run.timeline.push({ agent, kind: "handoff", key: event.key, text: event.text });
  if (event.type === "usage") entry.usage = { ...event.usage, scope: event.scope };
  if (event.type === "limit") {
    entry.usageLimit = event.limit;
    run.timeline.push({ agent, kind: "limit", key: randomUUID() });
  }
  if (event.type === "answer" && typeof event.text === "string") entry.answer = event.text.slice(0, 20000);
  if (event.type !== "message" || typeof event.text !== "string" || !event.text.trim()) return;
  const key = event.key ?? randomUUID();
  const previous = entry.messages.find((message) => message.key === key);
  if (previous) previous.text = event.text.slice(0, 20000);
  else {
    entry.messages.push({ key, text: event.text.slice(0, 20000) });
    run.timeline.push({ agent, kind: "message", key });
  }
  entry.messages = entry.messages.slice(-6);
  run.timeline = run.timeline.slice(-36);
}

function recordSteer(run, id, text, agent = "codex", images) {
  run.timeline.push({ agent, kind: "steer", key: id, text, ...(images?.length && { images }) });
  run.timeline = run.timeline.slice(-36);
}

function finishRun(run, status = "interrupted") {
  for (const entry of Object.values(run.agents)) {
    if (activeStatuses.has(entry.status)) entry.status = status;
  }
  run.finishedAt ??= new Date().toISOString();
}

function restoreWorkspace(workspace) {
  workspace.plugins = (workspace.plugins ?? []).map((plugin) => ({ enabled: true, scope: "both", ...plugin }));
  for (const task of workspace.tasks ?? [workspace]) {
    task.runHistory ??= [];
    for (const run of task.runHistory) {
      if (!run.finishedAt) finishRun(run);
      if (run.teamPlan?.applyStatus === "running") run.teamPlan.applyStatus = "interrupted";
    }
  }
  return workspace;
}

function retainRuns(history, run) {
  const next = [...history, run];
  const recent = Math.max(0, next.length - 24);
  return next.filter((entry, index) => index >= recent || unresolvedTeamPlan(entry));
}

module.exports = { newRun, recordEvent, recordSteer, finishRun, restoreWorkspace, retainRuns, evidenceText };
