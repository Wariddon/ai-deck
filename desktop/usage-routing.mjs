import { agentOutput, agentRole, planPair, unresolvedTeamPlan } from "./collaboration.mjs";

const modes = {
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

export function activeUsageLimit(limit, now = Date.now()) {
  return Boolean(limit && (!limit.resetAt || limit.resetAt > now));
}

export function routeMode(mode, connections, now = Date.now()) {
  const requested = Object.hasOwn(modes, mode) ? modes[mode] : [];
  const limited = requested.filter((agent) => activeUsageLimit(connections[agent]?.usageLimit, now));
  const remaining = requested.filter((agent) => !limited.includes(agent));
  const planner = planPair(mode)?.[0];
  const disconnected = remaining.filter((agent) => (!planner || planner === agent) && connections[agent]?.status !== "ready");
  return { requested, limited, disconnected, available: disconnected.length || planner && limited.includes(planner)
    ? [] : remaining.filter((agent) => connections[agent]?.status === "ready") };
}

export function singleAgentFallback(mode, connections, now = Date.now()) {
  const { requested, disconnected, limited } = routeMode(mode, connections, now);
  if (requested.length !== 2 || !disconnected.length) return null;
  const agent = requested.find((name) => !limited.includes(name) && !disconnected.includes(name));
  if (!agent) return null;
  if (planPair(mode)) return { agent, mode: planPair(mode)[0] === agent ? agent + "-plan" : agent === "codex" ? "codex" : "claude-write" };
  const review = agentRole(mode, agent) === "review";
  return { agent, mode: agent === "codex" ? review ? "codex-review" : "codex" : review ? "claude" : "claude-write" };
}

export function continuationFor(workspace, runId) {
  if (!workspace?.worktree || workspace.readOnly) return null;
  const runs = workspace.runHistory ?? [];
  const latest = runs.at(-1);
  const readyPlan = (entry) => entry?.finishedAt && unresolvedTeamPlan(entry) && entry.teamPlan.applyStatus !== "running" &&
    entry.teamPlan.worktree === workspace.worktree && (!entry.teamPlan.base || entry.teamPlan.base === workspace.base);
  const pending = runs.findLast(readyPlan);
  const run = runId ? runs.find((entry) => entry.id === runId) : latest;
  const planContinuation = (entry) => {
    if (!entry) return null;
    const { from, to: agent } = entry.teamPlan;
    return { runId: entry.id, kind: "apply-team-plan", from, agent, mode: agent === "codex" ? "codex" : "claude-write" };
  };
  const pendingContinuation = () => runId ? null : planContinuation(pending);
  if (!run?.finishedAt) return null;
  if (readyPlan(run)) return planContinuation(run);
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
