const { test } = require("node:test"), assert = require("node:assert/strict");
const { teamReviewGuidance, teamReviewFingerprint, recordReviewSkill } = require("../desktop/team-review-skill.cjs");
const options = { teamReviewSkill: true };
const names = (role, stage, evidence, settings = options) => teamReviewGuidance(settings, role, stage, evidence).map(item => item.name);
const packet = (file, lines) => ({ changedPaths: [file], body: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n${lines}` });

test("review guidance selects behavioral checks for code and failure review for changed error paths", () => {
  assert.deepEqual(names("review", undefined, packet("README.md", "+Document catch and retry behavior")), ["verification-before-completion"]);
  assert.deepEqual(names("review", undefined, packet("service.js", "+export const limit = 5;")), ["verification-before-completion", "pr-test-analyzer"]);
  for (const lines of ["+try { return await load(); } catch { return []; }", "-catch (error) { showFailure(error); }\n+return [];"])
    assert.deepEqual(names("review", undefined, packet("service.js", lines)), ["verification-before-completion", "pr-test-analyzer", "silent-failure-hunter"]);
  assert.deepEqual(names("review", undefined, "User asks to catch all errors"), ["verification-before-completion"]);
  assert.doesNotThrow(() => names("review", undefined, { body: null, info: { includedPaths: {} } }));
});

test("stage guidance stays bounded, honors opt-out and does not turn a focused repair into another full review", () => {
  assert.deepEqual(names("plan"), ["writing-plans"]);
  assert.deepEqual(names("plan", undefined, undefined, { ...options, sharedWork: false }), []);
  assert.deepEqual(names("write", undefined, undefined, { ...options, sharedWork: false }), ["verification-before-completion"]);
  const error = packet("service.js", "+const load = () => fetch('/data').catch(() => []);");
  assert.deepEqual(names("write", "repair", error), ["receiving-code-review"]);
  assert.deepEqual(names("review", "answer evidence request", error), ["receiving-code-review"]);
  assert.deepEqual(names("review", undefined, error, { teamReviewSkill: false }), []);
  for (const role of ["plan", "write", "review", "summary"])
    assert.ok(teamReviewGuidance(options, role, undefined, error).reduce((size, item) => size + item.text.length, 0) < 2600, "Only bounded role guidance belongs in each prompt");
});

test("both team runners and Auto Team retain actual applied guidance without duplicate usage entries", () => {
  const initial = teamReviewGuidance(options, "review", undefined, packet("service.js", "+return value;"));
  const error = teamReviewGuidance(options, "review", undefined, packet("service.js", "+return load().catch(() => []);"));
  for (const key of ["collaboration", "autoTeam", "teamReview"]) {
    const run = { [key]: {} };
    recordReviewSkill(run, "member-one", "review", initial);
    recordReviewSkill(run, "member-one", "review", error);
    recordReviewSkill(run, "member-one", "review", error);
    assert.equal(run[key].skillUsage.length, 1);
    assert.deepEqual(run[key].skillUsage[0].skills, ["ai-deck-team-review", "verification-before-completion", "pr-test-analyzer", "silent-failure-hunter"]);
    assert.match(run[key].skillUsage[0].guideHash, /^[a-f\d]{64}$/u);
  }
  assert.doesNotThrow(() => recordReviewSkill({}, "standalone", "write", []));
  assert.equal(teamReviewFingerprint(options), teamReviewFingerprint(options));
  assert.equal(teamReviewFingerprint({ teamReviewSkill: false }), null);
});
