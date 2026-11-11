import { codeGraphQuery } from "./code-graph-query.mjs";

export const reviewPolicies = {
  economy: { label: "Economy", diffLimit: 8000, newLimit: 3000, reportLimit: 650,
    description: "Compact diff and one focused review when files change." },
  normal: { label: "Normal", diffLimit: 20000, newLimit: 8000, reportLimit: 1200,
    description: "One independent review and a team lead summary when the turn limit allows." },
  smart: { label: "Smart", diffLimit: 8000, newLimit: 3000, reportLimit: 650,
    description: "Compact context. Review unless a small text-only edit passes the checkout checks." },
  thorough: { label: "Thorough", diffLimit: 32000, newLimit: 12000, reportLimit: 2000,
    description: "Wider evidence and up to one scoped fix and recheck when the reviewer requests changes." },
};

export function reviewPolicy(value) {
  return Object.hasOwn(reviewPolicies, value) ? value : "normal";
}

export function teamRunOptions(policy, value) {
  const compact = policy === "economy" || policy === "smart";
  const source = value?.context;
  const selection = (ids) => Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === "string" && id.length <= 120))].slice(0, 60) : undefined;
  const writerNotes = selection(source?.writerNotes);
  const reviewerNotes = selection(source?.reviewerNotes);
  const codeGraph = codeGraphQuery(value?.codeGraph);
  return {
    context: {
      ...(writerNotes && { writerNotes }), ...(reviewerNotes && { reviewerNotes }),
      brief: source?.brief !== false, decisions: source?.decisions !== false,
      history: typeof source?.history === "boolean" ? source.history : !compact,
      diff: source?.diff !== false,
    },
    turnLimit: Number.isInteger(value?.turnLimit) && value.turnLimit >= 1 && value.turnLimit <= 5
      ? value.turnLimit : policy === "thorough" ? 4 : policy === "normal" ? 3 : 2,
    alwaysReview: value?.alwaysReview === true,
    runChecks: value?.runChecks === true,
    autoEvidenceChecks: value?.autoEvidenceChecks === true,
    freshReview: true,
    teamReviewSkill: value?.teamReviewSkill !== false,
    traceBug: value?.teamReviewSkill !== false && value?.traceBug === true,
    ...(codeGraph && { codeGraph }),
    ...(value?.askForEvidence === true && { askForEvidence: true }),
  };
}

export function teamContextNotes(notes, skillIds = [], policy, context, role) {
  const selected = role === "write" ? context.writerNotes : context.reviewerNotes;
  if (selected) return notes.filter(({ id }) => selected.includes(id));
  const compact = policy === "economy" || policy === "smart";
  return notes.filter(({ id, enabled }) => skillIds.includes(id) || !compact && role === "write" && enabled);
}

export function smartTextPath(prompt) {
  if (typeof prompt !== "string" || !prompt || prompt.length > 1600) return null;
  const paths = [...prompt.matchAll(/(?:^|[\s`'"(])([\w./-]+\.[a-z][a-z\d]{0,7})(?=$|[\s`'",:;)]|\.(?:\s|$))/giu)]
    .map(([, file]) => file);
  if (new Set(paths).size !== 1 || /(?:migration|schema|credential|secret|deploy|command|script|config|\.env\b|review|hand.?off|claude|ฐานข้อมูล|สคริปต์|ดีพลอย|ส่งต่อ|รีวิว)/iu.test(prompt)) return null;
  const file = paths[0];
  return /\.(?:md|txt|rst)$/iu.test(file) && file.split("/").every((part) => part && !part.startsWith(".")) ? file : null;
}

export function smartReviewCandidate(file, packet) {
  return Boolean(file && !packet.info.partial && packet.changedPaths?.length === 1 && packet.changedPaths[0] === file &&
    packet.info.includedPaths?.length === 1 && packet.info.includedPaths[0] === file && packet.diffChars <= 3500);
}

export function matchingDecision(decision, scope) {
  return Boolean(scope && decision.scope?.branch === scope.branch && decision.scope?.base === scope.base);
}

export function usableDecisions(decisions, scope) {
  return (decisions ?? []).filter((item) => matchingDecision(item, scope)).sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true));
}

export function sentTurns(run) {
  return Object.values(run.agents).reduce((total, record) => total + (record.providerCalls ?? 0), 0);
}

export function teamStagePrompt(agent, role, kind, peerOnly) {
  const name = agent === "claude" ? "Claude Code" : "Codex";
  const peer = agent === "claude" ? "Codex" : "Claude Code";
  if (role === "review") {
    const scope = peerOnly ? "Review the teammate's report. Identify claims you cannot verify without a diff."
      : kind === "recheck" ? "Recheck the specific repair and flag findings that remain unresolved."
        : "Independently verify the teammate's handoff against the supplied evidence.";
    return `You are ${name}, the read-only reviewer. ${peer} owns implementation. ${scope} Start with the acceptance criteria in the current user request and any material regression introduced by this change. Cite the evidence or name the single missing check that matters. Reuse a matched check as recorded evidence. Repeat it only for a distinct reason and state the reason.`;
  }
  return kind === "repair" ? `You are ${name}, the builder. Address only ${peer}'s scoped review findings from this run. The original request is context for the repair.`
    : `You are ${name}, the builder. Own the requested implementation and verification. ${peer} will independently review your handoff. Leave a concise note with what is done, what you verified, and one specific point where a teammate could help. If nothing needs additional checking, say so.`;
}

export function priorTeamResult(history, mode) {
  const run = history.findLast((entry) => entry.finishedAt && entry.mode === mode && !entry.discussion && !entry.greeting &&
    entry.collaboration && (entry.followupReview || entry.collaboration.handoffs.length || entry.collaboration.verdict));
  if (!run) return undefined;
  const followup = run.followupReview && history.find(({ id }) => id === run.followupReview);
  const { verdict, findings, handoffs } = followup?.collaboration ?? run.collaboration;
  const report = handoffs.findLast(({ kind }) => kind === "build");
  return { runId: run.id, at: run.finishedAt, verdict,
    text: (findings || report?.summary || "").slice(0, 700), files: report?.files.slice(0, 8) ?? [] };
}
