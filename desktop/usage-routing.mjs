import { agentOutput, agentRole, autoTeam, discussionMode, parallelChecksMode, planPair, unresolvedTeamPlan } from "./collaboration.mjs";

const modes = {
  "auto-team": ["codex", "claude"],
  [discussionMode]: ["codex", "claude"],
  [parallelChecksMode]: ["codex", "claude"],
  team: ["codex", "claude"],
  "claude-team": ["claude", "codex"],
  "build-review": ["codex", "claude"],
  "claude-build-review": ["claude", "codex"],
  "parallel-write": ["codex", "claude"],
  "claude-parallel-write": ["claude", "codex"],
  "claude-plan-codex": ["claude", "codex"],
  "codex-plan-claude": ["codex", "claude"],
  codex: ["codex"],
  "codex-review": ["codex"],
  "codex-plan": ["codex"],
  claude: ["claude"],
  "claude-plan": ["claude"],
  "claude-write": ["claude"],
};

export function providerUsesApi(agent, authMethod) {
  return agent === "codex" ? authMethod === "api-key" : ["apiKey", "console", "api-key"].includes(authMethod);
}

export function quotaBadgeWindow(agent, connection, now = Date.now()) {
  if (connection?.status !== "ready" || providerUsesApi(agent, connection.authMethod)) return null;
  const account = connection.accountQuota;
  const hasPercentage = ({ usedPercent }) => Number.isFinite(usedPercent) && usedPercent >= 0 && usedPercent <= 100;
  const reportedAt = account?.windows?.some(hasPercentage) ? account.fetchedAt : 0;
  const windows = [...(account?.windows ?? []),
    ...(connection.quota ?? []).filter(({ observedAt }) => (observedAt ?? 0) >= (reportedAt ?? 0))];
  const current = new Map();
  for (const window of windows) {
    if (!hasPercentage(window)) continue;
    if (window.resetAt ? window.resetAt <= now : now - (window.observedAt ?? 0) >= 30 * 60_000) continue;
    const key = window.id;
    const previous = current.get(key);
    if (!previous || (window.observedAt ?? 0) >= (previous.observedAt ?? 0)) current.set(key, window);
  }
  const numeric = [...current.values()];
  const primary = agent === "codex" ? numeric.filter(({ id }) => typeof id === "string" && id.startsWith("codex:")) : [];
  return (primary.length ? primary : numeric).sort((left, right) => right.usedPercent - left.usedPercent)[0] ?? null;
}

export function activeUsageLimit(limit, now = Date.now()) {
  return Boolean(limit && (!limit.resetAt || limit.resetAt > now));
}

export function routeMode(mode, connections, now = Date.now(), leadOnly = false) {
  const team = Object.hasOwn(modes, mode) ? modes[mode] : [];
  const requested = leadOnly ? team.slice(0, 1) : team;
  const limited = requested.filter((agent) => activeUsageLimit(connections[agent]?.usageLimit, now));
  const remaining = requested.filter((agent) => !limited.includes(agent));
  const planner = planPair(mode)?.[0];
  const disconnected = remaining.filter((agent) => (!planner || planner === agent) && connections[agent]?.status !== "ready");
  return { requested, limited, disconnected, available: disconnected.length || autoTeam(mode) && limited.length || planner && limited.includes(planner)
    ? [] : remaining.filter((agent) => connections[agent]?.status === "ready") };
}

export function messageIntentAgents(mode, connections, now = Date.now()) {
  return routeMode(mode, connections, now).requested.filter((agent) => routeMode(agent, connections, now).available.length);
}

export function singleAgentFallback(mode, connections, now = Date.now()) {
  if (mode === discussionMode) return null;
  const { requested, disconnected, limited } = routeMode(mode, connections, now);
  if (requested.length !== 2 || !disconnected.length && !(autoTeam(mode) && limited.length)) return null;
  const agent = requested.find((name) => !limited.includes(name) && !disconnected.includes(name));
  if (!agent) return null;
  if (autoTeam(mode)) return { agent, mode: agent + "-plan" };
  if (planPair(mode)) return { agent, mode: planPair(mode)[0] === agent ? agent + "-plan" : agent === "codex" ? "codex" : "claude-write" };
  const review = agentRole(mode, agent) === "review";
  return { agent, mode: agent === "codex" ? review ? "codex-review" : "codex" : review ? "claude" : "claude-write" };
}

export function linkedUsageRecovery(workspace, mode, connections, now = Date.now()) {
  if (!workspace?.linkedSession || !["codex", "codex-review", "claude", "claude-write"].includes(mode)) return null;
  const from = mode.startsWith("codex") ? "codex" : "claude";
  const last = workspace.runHistory?.at(-1);
  const route = routeMode(mode, connections, now);
  const limitedRun = last?.finishedAt && last.agents[from]?.status === "limited" ? last : null;
  if (!route.limited.includes(from) && !limitedRun) return null;
  const agent = from === "codex" ? "claude" : "codex";
  const write = !workspace.readOnly && (mode === "codex" || mode === "claude-write");
  const nextMode = agent === "codex" ? write ? "codex" : "codex-review" : write ? "claude-write" : "claude";
  return { from, agent, mode: nextMode, limitedRun, available: routeMode(nextMode, connections, now).available.includes(agent) };
}

export function autoTeamPlanBaseMatches(plan) {
  return typeof plan?.requiredBase === "string" && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(plan.requiredBase) &&
    plan.requiredBase === plan.git?.head;
}

export function autoTeamPlanNeedsBaseCheck(run) {
  return Boolean(run?.finishedAt && run.teamPlan?.strategy && unresolvedTeamPlan(run) &&
    run.teamPlan.applyStatus !== "running" && !autoTeamPlanBaseMatches(run.teamPlan));
}

export function continuationFor(workspace, runId) {
  if (!workspace?.worktree || workspace.linkedSession) return null;
  const runs = workspace.runHistory ?? [];
  const latest = runs.at(-1);
  if (latest?.finishedAt && latest.autoTeam?.status === "limited" && latest.autoTeam.planResume && (!runId || latest.id === runId)) {
    return { runId: latest.id, kind: "resume-auto-plan", mode: "auto-team", resumeRunId: latest.id, strategy: "planning" };
  }
  if (workspace.readOnly) return null;
  const readyPlan = (entry) => entry?.finishedAt && unresolvedTeamPlan(entry) && entry.teamPlan.applyStatus !== "running" &&
    entry.teamPlan.worktree === workspace.worktree && (!entry.teamPlan.base || entry.teamPlan.base === workspace.base);
  const run = runId ? runs.find((entry) => entry.id === runId) : latest;
  const planContinuation = (entry) => {
    if (!readyPlan(entry)) return null;
    const { from, to: agent } = entry.teamPlan;
    if (entry.teamPlan.strategy) {
      if (!autoTeamPlanBaseMatches(entry.teamPlan)) return null;
      const previous = runs.find(({ id }) => id === entry.teamPlan.applyRunId);
      const resumable = entry.teamPlan.applyStatus === "limited" && previous?.autoTeam?.resume;
      if (entry.teamPlan.applyStatus && !resumable) return null;
      return { runId: entry.id, kind: "apply-team-plan", from, agent, mode: "auto-team",
        strategy: entry.teamPlan.strategy, ...(resumable && { resumeRunId: previous.id }) };
    }
    return { runId: entry.id, kind: "apply-team-plan", from, agent, mode: agent === "codex" ? "codex" : "claude-write" };
  };
  const pendingContinuation = () => runId ? null : runs.reduceRight((found, entry) => found ?? planContinuation(entry), null);
  if (!run?.finishedAt) return null;
  const currentPlan = planContinuation(run);
  if (currentPlan) return currentPlan;
  if (run.teamPlan || run !== latest) return pendingContinuation();
  const pair = planPair(run.mode);
  if (pair && run.agents[pair[0]]?.status === "completed" && agentOutput(run.agents[pair[0]]) && run.agents[pair[1]]?.status === "limited") {
    const [from, agent] = pair;
    return { runId: run.id, kind: "apply-team-plan", from, agent, mode: agent === "codex" ? "codex" : "claude-write" };
  }
  if (run.mode === "claude-plan" && workspace.claudePlanSession && run.agents.claude?.status === "completed") {
    return { runId: run.id, kind: "apply-plan", agent: "claude", mode: "claude-write" };
  }
  const builder = ["codex", "team", "build-review"].includes(run.mode) ? "codex" :
    ["claude-write", "claude-build-review", "claude-team"].includes(run.mode) ? "claude" : null;
  if (!builder || run.agents[builder]?.status !== "limited") return pendingContinuation();
  const agent = builder === "codex" ? "claude" : "codex";
  return { runId: run.id, kind: "usage-handoff", from: builder, agent, mode: agent === "codex" ? "codex" : "claude-write" };
}
