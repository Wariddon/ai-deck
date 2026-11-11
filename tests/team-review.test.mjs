import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeReviewFindings, sharedBriefPrompt, freshReviewPrompt } from "../desktop/team-review.mjs";
import { normalizeTeamwork } from "../desktop/collaboration.mjs";
import { normalizeSessionTeam, sessionMemberInputs } from "../desktop/session-team.mjs";
import { teamRunOptions } from "../desktop/team-handoff.mjs";

test("shared review consolidates matching issues without losing distinct findings or original reports", () => {
  const first = mergeReviewFindings([], "FINDING NIT | src/a.ts:7 | Handle null input", "codex");
  const second = mergeReviewFindings(first, "FINDING MAJOR | SRC/A.TS:7 | Handle  null input\nFINDING MAJOR | src/a.ts:7 | Verify permission", "claude");
  assert.equal(second.length, 2);
  assert.equal(second[0].id, "F1");
  assert.equal(second[0].severity, "major");
  assert.deepEqual(second[0].reviewers, ["codex", "claude"]);
  assert.deepEqual(first[0].reviewers, ["codex"]);
  assert.equal(first[0].severity, "nit");
  assert.equal(mergeReviewFindings(second, "FINDING MAJOR | src/a.ts:7 | Verify permission", "claude").length, 2);
  assert.equal(mergeReviewFindings([], "> FINDING MAJOR | brief | Quoted\n```text\nFINDING BLOCKER | brief | Example\n```", "claude").length, 0);
});

test("the shared brief keeps constraints and open questions and bounds input", () => {
  const brief = normalizeTeamwork({ brief: "Outcome", constraints: " No deploy ", questions: "Which input?", outcome: "Tests pass" });
  const prompt = sharedBriefPrompt(brief, [{ text: "Keep API compatibility" }]);
  for (const expected of ["Outcome", "No deploy", "Which input?", "Tests pass", "Keep API compatibility"]) assert.ok(prompt.includes(expected));
  assert.throws(() => normalizeTeamwork({ constraints: "x".repeat(2000) }), /1,500/);
  assert.equal(sharedBriefPrompt(undefined), "");
  assert.match(freshReviewPrompt(), /Treat teammate reports as claims/);
});

test("fresh review runs automatically and preserves current evidence while removing prior history", () => {
  const member = { id: "member-00000000-0000-4000-8000-000000000001", provider: "claude", name: "Reviewer", position: "review", model: "", instructions: "" };
  const team = normalizeSessionTeam({ members: [member] });
  assert.equal(team.freshReview, true);
  assert.equal(teamRunOptions("normal").freshReview, true);
  assert.equal(teamRunOptions("normal", { freshReview: false }).freshReview, true);
  const input = { member, userPrompt: "current request", projectPrompt: "current brief", prior: "outdated conclusion",
    diff: "current source diff", handoffs: [{ name: "Builder", text: "current handoff", projectData: true }] };
  const fresh = sessionMemberInputs({ ...input, team });
  assert.equal(fresh.prior, "");
  assert.equal(fresh.prompt, input.projectPrompt);
  assert.equal(fresh.diff, input.diff);
  assert.deepEqual(fresh.handoffs, input.handoffs);
  assert.equal(sessionMemberInputs({ ...input, member: { ...member, position: "write" }, team }).prior, input.prior);
  assert.equal(sessionMemberInputs({ ...input, team: normalizeSessionTeam({ ...team, freshReview: false }) }).prior, "");
});
