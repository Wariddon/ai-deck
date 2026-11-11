import { agentOutput } from "../desktop/collaboration.mjs";

export function displayedTeamRun(run, runs) {
  const original = run.collaboration?.resumedFrom && runs.find(({ id }) => id === run.collaboration.resumedFrom);
  if (original?.followupReview !== run.id || !original.collaboration) return run;
  const earlier = original.collaboration.handoffs ?? [];
  const resumedCriterion = run.resumedRepair ?? run.resumedEvidence;
  const resumedKind = run.resumedRepair ? "repair" : "evidence reply";
  const retained = resumedCriterion && earlier.filter((card) => card.kind !== resumedKind || card.criterionId !== resumedCriterion);
  return { ...run, mode: original.mode, agents: { ...original.agents, ...run.agents },
    collaboration: { ...run.collaboration, turnLimit: undefined,
      ...(retained && { handoffs: [...retained, ...run.collaboration.handoffs] }),
      contextByAgent: { ...original.collaboration.contextByAgent, ...run.collaboration.contextByAgent } } };
}

export function withDiscussionPeers(rows, runs) {
  const discussions = new Map(runs.filter((run) => run.discussion).map((run) => {
    const delivered = run.collaboration?.handoffs?.find((card) => card.kind === "discussion reply" && card.sent);
    const closing = run.agents[delivered?.to];
    return [run.id, { delivered, conclusion: closing?.status === "completed" && agentOutput(closing) }];
  }));
  if (!discussions.size) return rows;
  return rows.flatMap((row) => {
    const id = row.id.split(":", 1)[0];
    const discussion = discussions.get(id);
    if (!discussion) return [row];
    if (row.handoff) return [];
    if (row.kind !== "message") return [row];
    const { delivered, conclusion } = discussion;
    if (delivered?.from === row.agent) return [{ ...row, to: delivered.to }];
    if (delivered?.to === row.agent && conclusion && row.text.trim() === conclusion) return [{ ...row, discussionConclusion: true }];
    return [row];
  });
}

export function withTeamResults(rows, runs) {
  const completed = new Map(runs.filter((run) => run.finishedAt && (run.collaboration || run.sessionTeam)).map((run) => [run.id, run]));
  if (!completed.size) return rows;
  const combined = new Map([...completed.values()].filter((run) => run.collaboration?.resumedFrom)
    .map((run) => [run.id, displayedTeamRun(run, runs)]).filter(([id, run]) => run !== completed.get(id)));
  const superseded = new Set([...combined.values()].map((run) => run.collaboration.resumedFrom));
  const lastRow = new Map(rows.map((row, index) => [row.id.split(":", 1)[0], index]));
  const work = new Map();
  for (const row of rows) {
    const id = row.id.split(":", 1)[0];
    const run = completed.get(id);
    if (!run || run.discussion || row.kind !== "activity" || row.handoff && !run.sessionTeam) continue;
    if (!work.has(id)) work.set(id, []);
    work.get(id).push(row);
  }
  return rows.flatMap((row, index) => {
    const id = row.id.split(":", 1)[0];
    const run = completed.get(id);
    if (!run) return [row];
    const visible = !run.discussion && (row.kind === "message" || row.kind === "activity") || combined.has(id) && row.kind === "prompt" ? [] : [row];
    if (!superseded.has(id) && lastRow.get(id) === index) {
      const previous = combined.has(id) ? work.get(run.collaboration.resumedFrom) ?? [] : [];
      visible.push({ id: id + ":team-result", kind: "team-result", run: combined.get(id) ?? run, work: [...previous, ...(work.get(id) ?? [])] });
    }
    return visible;
  });
}

function withAutoTeamDecisions(rows, runs) {
  const plans = new Map(runs.filter((run) => run.autoTeam && !run.autoTeam.planId).map((run) => [run.id, run]));
  if (!plans.size) return rows;
  const decisions = new Map();
  const latest = new Map();
  for (const row of rows) {
    if (row.kind !== "message") continue;
    const run = plans.get(row.id.split(":", 1)[0]);
    if (!run) continue;
    const reviewer = run.teamPlan?.from ?? (run.autoTeam.planner === "claude" ? "codex" : "claude");
    if (row.agent !== reviewer || !/^(?:```[^\r\n]*\r?\n[ \t]*)?AI_DECK_AUTO(?=[:\s]|$)/u.test(row.text?.trimStart() ?? "")) continue;
    decisions.set(row.id, run);
    latest.set(run.id, row.id);
  }
  if (!decisions.size) return rows;
  return rows.flatMap((row) => {
    const run = decisions.get(row.id);
    if (!run) return [row];
    if (latest.get(run.id) !== row.id) return [];
    return [{ ...row, text: run.teamPlan?.text || (run.finishedAt ? "No team decision was saved." : "Checking the team plan…"),
      planDecision: run.teamPlan ?? null }];
  });
}

function project(rows, runs, split) {
  const visible = withAutoTeamDecisions(rows, runs);
  return withDiscussionPeers(split ? visible : withTeamResults(visible, runs), runs);
}
const samePrefix = (cached, source, count) => cached?.length === count && cached.every((item, index) => item === source[index]);

export function createTimelineProjector() {
  let history;
  return (rows, runs, split) => {
    const latest = runs.at(-1);
    const active = latest && !latest.finishedAt ? rows.findLastIndex((row) => row.id === latest.id + ":prompt") : -1;
    const rowCount = active < 0 ? rows.length : active;
    const runCount = active < 0 ? runs.length : runs.length - 1;
    if (history?.split !== split || !samePrefix(history?.rows, rows, rowCount) || !samePrefix(history?.runs, runs, runCount)) {
      const past = rows.slice(0, rowCount);
      const recorded = runs.slice(0, runCount);
      history = { rows: past, runs: recorded, split, projected: project(past, recorded, split) };
    }
    return active < 0 ? history.projected : [...history.projected, ...project(rows.slice(active), [latest], split)];
  };
}
