const { randomUUID } = require("node:crypto");
const { planPair, unresolvedTeamPlan } = require("./collaboration.mjs");
const { testCommand } = require("./delivery.cjs");
const { runModelProfile } = require("./agent-settings.mjs");

const activeStatuses = new Set(["queued", "preparing", "running"]);
const stageClocks = new WeakMap();

async function timeStage(run, agent, kind, action) {
  const stage = { agent, kind, startedAt: new Date().toISOString() };
  const previous = run.stages?.at(-1);
  if (previous?.agent !== agent && Number.isFinite(previous?.durationMs) &&
      ["review", "discussion", "recheck", "recheck evidence", "answer evidence request"].includes(kind)) {
    stage.teammateMs = previous.durationMs;
  }
  (run.stages ??= []).push(stage);
  const clock = { started: performance.now(), commands: new Set(), toolMs: 0 };
  stageClocks.set(stage, clock);
  try { return await action(); }
  finally {
    const end = performance.now();
    stage.durationMs = Math.round(end - clock.started);
    stage.toolMs = Math.round(clock.toolMs + (clock.commands.size ? end - clock.toolStarted : 0));
    stageClocks.delete(stage);
  }
}

function recordStageEvent(run, agent, event) {
  const stage = run.stages?.findLast((entry) => entry.agent === agent && entry.durationMs === undefined);
  const clock = stage && stageClocks.get(stage);
  if (!clock) return;
  if (stage.firstActivityMs === undefined && ["message", "delta", "command-start", "approval", "question"].includes(event.type)) {
    stage.firstActivityMs = Math.round(performance.now() - clock.started);
  }
  if (event.type === "command-start" && event.key) {
    if (!clock.commands.size) clock.toolStarted = performance.now();
    clock.commands.add(event.key);
  } else if (event.type === "command-result" && clock.commands.delete(event.key) && !clock.commands.size) {
    clock.toolMs += performance.now() - clock.toolStarted;
  }
}

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
    ...(approval ? { title: evidenceText(event.title), subject: evidenceText(event.subject), status: event.accepted ? "allowed" : "declined",
      ...(typeof event.commandId === "string" && { commandId: event.commandId }) }
      : { subject: evidenceText(event.command), status: event.status,
        ...(Number.isSafeInteger(event.exitCode) && { exitCode: event.exitCode }),
        ...((run.linkedTurn || event.hook || testCommand(event.command)) && event.output && { output: evidenceText(event.output) }) }),
  };
  run.evidence = [...(run.evidence ?? []).filter((item) => item.agent !== agent || item.id !== evidence.id || item.kind !== evidence.kind), evidence].slice(-60);
}

function newRun(mode, prompt, agents, lowMemory = false) {
  return {
    id: randomUUID(), mode, prompt, startedAt: new Date().toISOString(), finishedAt: null,
    timeline: [], ...(lowMemory && agents.length > 1 && { lowMemory: true }),
    agents: Object.fromEntries(agents.map((agent, index) => [agent, {
      status: (mode === "auto-team" || index > 0 && (lowMemory || mode === "build-review" || mode === "claude-build-review" || planPair(mode))) ? "queued" : "preparing",
      messages: [],
    }])),
  };
}

function recordEvent(run, agent, event) {
  const entry = run.agents[agent];
  if (!entry) return;
  if (event.type === "approval-decision" || event.type === "command-result") recordEvidence(run, agent, event);
  if (event.type === "status") entry.status = event.status;
  if (event.type === "run-model") {
    if (event.model) entry.reportedModel = event.model;
    if (event.effort) entry.reportedEffort = event.effort;
  }
  if (event.type === "handoff") run.timeline.push({ agent, kind: "handoff", key: event.key, text: event.text });
  if (event.type === "usage") entry.usage = { ...event.usage, scope: event.scope };
  if (event.type === "provider-call") entry.providerCalls = (entry.providerCalls ?? 0) + 1;
  if (event.type === "provider-usage") {
    const previous = entry.runTokens ?? {};
    entry.runTokens = Object.fromEntries(["input", "output", "cached", "total"].map((key) =>
      [key, (previous[key] ?? 0) + (event.usage[key] ?? 0)]));
    entry.runTokens.reports = (previous.reports ?? 0) + 1;
  }
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
    const profile = event.profile ?? runModelProfile(entry);
    entry.messages.push({ key, text: event.text.slice(0, 20000), ...(profile && { profile }) });
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
  if (status === "interrupted" && run.autoTeam?.status === "running") run.autoTeam.status = status;
  for (const entry of Object.values(run.agents)) {
    if (activeStatuses.has(entry.status)) entry.status = status;
  }
  run.finishedAt ??= new Date().toISOString();
}

function clearPendingReview(run, followup) {
  if (run.reviewPending) run.reviewPending = false;
  if (followup) run.followupReview = followup;
  if (run.collaboration) {
    delete run.collaboration.reviewCheckpoint;
    delete run.collaboration.pauseReason;
  }
}

function restoreWorkspace(workspace) {
  workspace.plugins = (workspace.plugins ?? []).map((plugin) => ({ enabled: true, scope: "both", ...plugin }));
  for (const task of workspace.tasks ?? [workspace]) {
    task.runHistory ??= [];
    for (const run of task.runHistory) {
      const reviewer = run.collaboration?.reviewCheckpoint?.reviewer;
      if (run.finishedAt && reviewer && run.collaboration.verdict === "blocked" && run.agents[reviewer]?.status === "completed") {
        clearPendingReview(run);
      }
      if (!run.finishedAt || run.autoTeam?.status === "running") {
        run.recoveredAfterRestart = true;
        finishRun(run);
      }
      if (run.teamPlan?.applyStatus === "running") run.teamPlan.applyStatus = "interrupted";
    }
  }
  return workspace;
}

function retainRuns(history, run, pinned = []) {
  const next = [...history, run];
  const recent = Math.max(0, next.length - 24);
  const keep = new Set(pinned);
  for (const entry of next) {
    if (unresolvedTeamPlan(entry) && entry.teamPlan.strategy && entry.teamPlan.applyRunId) keep.add(entry.teamPlan.applyRunId);
  }
  return next.filter((entry, index) => index >= recent || keep.has(entry.id) || unresolvedTeamPlan(entry));
}

module.exports = { newRun, recordEvent, recordSteer, finishRun, clearPendingReview, restoreWorkspace, retainRuns, evidenceText, timeStage, recordStageEvent };
