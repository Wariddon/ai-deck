const plans = {
  "claude-plan-codex": ["claude", "codex"],
  "codex-plan-claude": ["codex", "claude"],
};

const teamWorkflows = {
  team: ["team", "claude-team"],
  "build-review": ["build-review", "claude-build-review"],
  "codex-plan-claude": ["codex-plan-claude", "claude-plan-codex"],
  "parallel-write": ["parallel-write", "claude-parallel-write"],
};

export const workflowFamily = (mode) => Object.keys(teamWorkflows).find((key) => teamWorkflows[key].includes(mode)) ?? mode;
export const teamWorkflowMode = (family, lead) => Object.hasOwn(teamWorkflows, family) ? teamWorkflows[family][lead === "claude" ? 1 : 0] : family;
export const separateEdits = (mode) => workflowFamily(mode) === "parallel-write";
export const buildThenReview = (mode) => workflowFamily(mode) === "build-review";

export function swapTeamAssignment(mode, teamwork) {
  const family = workflowFamily(mode);
  if (!Object.hasOwn(teamWorkflows, family)) return null;
  const modes = teamWorkflows[family];
  return { mode: modes.find((candidate) => candidate !== mode),
    teamwork: { ...teamwork, codex: teamwork?.claude ?? "", claude: teamwork?.codex ?? "" } };
}

export function changeWorkflow(draft, mode) {
  return draft.mode === mode ? draft : { ...draft, mode, reviewOf: null, reviewFiles: undefined, reviewTarget: undefined, reviewSince: undefined };
}

export const effectiveTeamwork = (draft, assignment, project) => draft ?? assignment?.teamwork ?? project;

export function defaultDraftMode(workspace) {
  if (workspace?.teamAssignment?.mode) return workspace.teamAssignment.mode;
  const recent = !workspace?.teamAssignment?.inherit &&
    workspace?.runHistory?.findLast((run) => !run.assignmentOnce && !run.continuedFrom);
  return recent?.mode ?? workspace?.teamMode ?? "team";
}

export function handoffTeamwork(teamwork, owner, agent) {
  return { ...teamwork, [agent]: teamwork?.[owner] ?? "" };
}
export const teamFields = ["brief", "codex", "claude", "outcome"];

export function planPair(mode) {
  return Object.hasOwn(plans, mode) ? plans[mode] : undefined;
}

export function agentRole(mode, agent) {
  if (planPair(mode)?.[0] === agent || mode === agent + "-plan") return "plan";
  if (agent === "codex" ? ["codex-review", "claude-build-review", "claude-team"].includes(mode) : ["team", "build-review", "claude"].includes(mode)) return "review";
  return "write";
}

export function teamReviewer(mode) {
  return ["team", "build-review"].includes(mode) ? "claude" : ["claude-team", "claude-build-review"].includes(mode) ? "codex" : null;
}

export function normalizeTeamwork(value) {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Enter a valid team brief.");
  const entries = teamFields.map((field) => {
    const text = value[field] ?? "";
    if (typeof text !== "string" || text.length > 1500 || text.includes("\0")) throw new Error("Keep each team field under 1,500 characters.");
    return [field, text.trim()];
  });
  return Object.fromEntries(entries.filter(([, text]) => text));
}

export function selectedContext(notes, skillIds = []) {
  if (!Array.isArray(skillIds) || skillIds.length > 30 || skillIds.some((id) => !notes.some((note) => note.id === id && note.source === "Skill"))) {
    throw new Error("One of the selected skills is unavailable. Update the draft’s skills.");
  }
  return notes.filter((note) => note.enabled || skillIds.includes(note.id));
}

export function teamInstructions(brief, agent) {
  return [
    brief?.brief && "Shared team brief:\n" + brief.brief,
    brief?.[agent] && "Your responsibility in this run:\n" + brief[agent],
    brief?.outcome && "The user’s completion and handoff requirements:\n" + brief.outcome,
  ].filter(Boolean).join("\n\n");
}

export function agentOutput(record) {
  return (record?.answer?.trim() || record?.messages?.at(-1)?.text?.trim() || "").slice(0, 6500);
}

export function unresolvedTeamPlan(run) {
  return run?.teamPlan?.state === "ready" && !["completed", "dismissed"].includes(run.teamPlan.applyStatus);
}

export const planResultCanBeConfirmed = (status) => ["changes-ready", "no-changes", "unverified"].includes(status);

export function classifyTeamPlan(result) {
  const output = result?.output?.trim() ?? "";
  const excerpt = output.slice(0, 12000);
  if (result?.status !== "completed") return { state: "blocked", text: excerpt };
  if (output.length > excerpt.length) return { state: "unclassified", text: excerpt + "\n\nThe plan exceeded the handoff size limit. Ask for a shorter plan." };
  const header = /^AI_DECK_PLAN:[ \t]*(READY|NEEDS_INPUT|BLOCKED)[ \t]*\r?\n/u.exec(output);
  if (!header) return { state: "unclassified", text: output };
  const text = output.slice(header[0].length).trim();
  const state = { READY: "ready", NEEDS_INPUT: "needs-input", BLOCKED: "blocked" }[header[1]];
  return { state: text ? state : "unclassified", text };
}
