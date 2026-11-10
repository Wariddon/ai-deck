import { separateWriteScopes } from "./team-paths.mjs";

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
export const autoTeam = (mode) => mode === "auto-team";
export const buildThenReview = (mode) => workflowFamily(mode) === "build-review";
export const discussionMode = "team-discussion";
export const parallelChecksMode = "parallel-checks";

export const defaultTeamMode = "build-review";

export function separateEditsIssue(mode, teamwork) {
  if (!separateEdits(mode)) return "";
  const scope = (agent) => (teamwork?.[agent] ?? "").trim().replace(/\s+/gu, " ").toLowerCase();
  const codex = scope("codex");
  const claude = scope("claude");
  if (!codex || !claude || codex === claude) return "Give Codex and Claude different responsibilities in Team Brief before using Separate edits.";
  try { separateWriteScopes(teamwork); }
  catch (error) { return error.message; }
  return "";
}

export function isTeamGreeting(text) {
  return /^(?:สวัสดี\s*(?:(?:ครับ|ค่ะ|คะ)\s*)?(?:ทีม(?:ฉัน|ของฉัน)?\s*)?(?:สบายดี(?:ไหม|มั้ย))?|สบายดี(?:ไหม|มั้ย)|(?:hi|hello|hey)[,\s]*(?:team|everyone)?)\s*(?:ครับ|ค่ะ|คะ)?\s*[.!！?？👋]*$/iu.test(text.trim());
}

export function teamConversation(draft) {
  if (draft.mode === discussionMode) return "discussion";
  if (!["team", "build-review", "parallel-write"].includes(workflowFamily(draft.mode)) || draft.images?.length ||
      draft.skillIds?.length || draft.reviewOf || draft.reviewTarget || draft.reviewSince || draft.reviewFiles !== undefined ||
      draft.followupRunId || draft.linkedStepId) return;
  const text = draft.prompt?.trim() ?? "";
  const thaiExchange = /^(?:(?:ผม|ฉัน)?\s*(?:แค่)?\s*(?:อยาก)?\s*ให้\s*)?(?:(?:พวกคุณ|คุณสองคน|ทั้งสองคน|ทั้งคู่|สองตัว|มัน|(?:Codex\s*(?:กับ|และ|\+)\s*Claude(?: Code)?|Claude(?: Code)?\s*(?:กับ|และ|\+)\s*Codex))\s*)?(?:(?:ลอง|ช่วย)\s*)?คุย\s*กัน\s*(?:เอง|เฉย\s*ๆ|หน่อย)?\s*(?:ได้(?:ไหม|มั้ย)|หน่อย)?\s*(?:ครับ|ค่ะ|คะ|นะ)?\s*[.!！?？]*$/iu;
  if (thaiExchange.test(text) || discussionContinuation(text) ||
      startsDiscussionTopic(text) ||
      /^(?:(?:คุณ)?(?:ทั้งสองคน|ทั้งคู่)\s*สบายดี(?:ไหม|มั้ย)|(?:can you (?:two|both) |please )?talk to each other|how are you both)\s*(?:ครับ|ค่ะ|คะ)?\s*[.!！?？]*$/iu.test(text)) return "discussion";
  if (isTeamGreeting(text)) return "greeting";
  if (/^(?:ถามหัวหน้าทีม|ถามทั่วไป|ask the lead|general question)\s*[:：]\s*\S/iu.test(text)) return "question";
}

export function startsDiscussionTopic(text) {
  return /^(?:คุยกัน|discuss together)\s*[:：]\s*\S/iu.test(text.trim());
}

export function discussionContinuation(text) {
  return /^(?:คุยกันต่อ|continue the discussion)(?:\s*[:：]\s*\S|\s*(?:ครับ|ค่ะ|คะ|นะ)?\s*[.!！?？]*$)/iu.test(text.trim());
}

export function swapTeamAssignment(mode, teamwork) {
  const family = workflowFamily(mode);
  if (!Object.hasOwn(teamWorkflows, family)) return null;
  const modes = teamWorkflows[family];
  return { mode: modes.find((candidate) => candidate !== mode),
    teamwork: { ...teamwork, codex: teamwork?.claude ?? "", claude: teamwork?.codex ?? "",
      ...((teamwork?.codexPaths !== undefined || teamwork?.claudePaths !== undefined) &&
        { codexPaths: teamwork?.claudePaths ?? "", claudePaths: teamwork?.codexPaths ?? "" }) } };
}

export function changeWorkflow(draft, mode) {
  return draft.mode === mode ? draft : { ...draft, mode, reviewOf: null, reviewFiles: undefined, reviewTarget: undefined, reviewSince: undefined, followupRunId: undefined, linkedStepId: undefined };
}

export function steerMode(run) {
  return run && !run.computer && !run.continuedFrom && !run.sessionTeam && !run.greeting && !run.discussion &&
    !autoTeam(run.mode) && !planPair(run.mode) ? run.mode : null;
}

export function steerableDraft(draft, mode) {
  return Boolean(mode && draft?.mode === mode && !draft.steering && !draft.assignmentOnce && draft.teamwork == null &&
    !draft.skillIds?.length && draft.reviewFiles === undefined && !draft.reviewOf && !draft.reviewTarget && !draft.reviewSince && !draft.followupRunId && !draft.linkedStepId &&
    !teamConversation(draft));
}

export const effectiveTeamwork = (draft, assignment, project) => draft ?? assignment?.teamwork ?? project;

export function defaultDraftMode(workspace) {
  if (workspace?.linkedSession) {
    return workspace.linkedSession.lastMode ?? (workspace.linkedSession.source.provider === "codex" ? "codex-review" : "claude");
  }
  if (workspace?.sessionTeam?.members?.length && workspace.sessionTeam.useByDefault) return "session-team";
  if (workspace?.teamAssignment?.mode) return workspace.teamAssignment.mode;
  const recent = !workspace?.teamAssignment?.inherit &&
    workspace?.runHistory?.findLast((run) => run.mode !== "session-team" && !run.assignmentOnce && !run.continuedFrom &&
      !run.collaboration?.resumedFrom && !run.greeting && !run.discussion && run.mode !== discussionMode);
  if (workspace?.teamMode && (!recent || ["team", "claude-team"].includes(recent.mode))) return workspace.teamMode;
  return ({ team: "build-review", "claude-team": "claude-build-review" })[recent?.mode] ?? recent?.mode ?? defaultTeamMode;
}

export function legacyEmptyDraftMode(workspace) {
  const recovery = workspace?.recoveryDraft;
  const draft = recovery?.draft;
  if (!draft || recovery.draftRevision || workspace.linkedSession || workspace.teamAssignment || workspace.teamMode ||
      workspace.sessionTeam?.useByDefault || !["team", "claude-team"].includes(draft.mode) || draft.prompt?.trim() ||
      Object.keys(draft).some((field) => field !== "mode" && field !== "prompt")) return undefined;
  return teamWorkflowMode("build-review", draft.mode === "claude-team" ? "claude" : "codex");
}

export function handoffTeamwork(teamwork, owner, agent) {
  return { ...teamwork, [agent]: teamwork?.[owner] ?? "" };
}
export const teamFields = ["brief", "codex", "claude", "outcome", "codexPaths", "claudePaths"];

export function planPair(mode) {
  return Object.hasOwn(plans, mode) ? plans[mode] : undefined;
}

export function agentRole(mode, agent) {
  if (mode === discussionMode || mode === parallelChecksMode) return "review";
  if (autoTeam(mode)) return "plan";
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

export const planResultCanBeConfirmed = (status) => ["changes-ready", "no-changes", "unverified", "team-reviewed"].includes(status);

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
