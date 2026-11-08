const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeTeamwork, selectedContext, teamInstructions, agentRole } = require("../desktop/collaboration.mjs");

test("role instructions are scoped to the intended agent and preserve an empty draft override", () => {
  const brief = normalizeTeamwork({ brief: "Shared", codex: "Implement", claude: "Review", outcome: "Checks" });
  assert.match(teamInstructions(brief, "codex"), /Shared[\s\S]+Implement[\s\S]+Checks/);
  assert.doesNotMatch(teamInstructions(brief, "codex"), /Review/);
  assert.deepEqual(normalizeTeamwork({ brief: " " }), {});
  assert.equal(normalizeTeamwork(undefined), undefined);
  assert.equal(agentRole("codex-plan-claude", "codex"), "plan");
  assert.equal(agentRole("claude-plan-codex", "codex"), "write");
});

test("a draft can add a shared skill without enabling it for the whole project", () => {
  const notes = [
    { id: "enabled", source: "Project", enabled: true }, { id: "skill", source: "Skill", enabled: false },
    { id: "disabled", source: "Claude", enabled: false },
  ];
  assert.deepEqual(selectedContext(notes).map(({ id }) => id), ["enabled"]);
  assert.deepEqual(selectedContext(notes, ["skill"]).map(({ id }) => id), ["enabled", "skill"]);
  assert.equal(notes[1].enabled, false);
  assert.throws(() => selectedContext(notes, ["disabled"]), /unavailable/);
});

test("swapping the two agents preserves the workflow family and moves instructions with the role", () => {
  const { effectiveTeamwork, swapTeamAssignment, teamWorkflowMode, workflowFamily } = require("../desktop/collaboration.mjs");
  const { routeMode } = require("../desktop/usage-routing.mjs");
  const roles = { brief: "shared", codex: "do first step", claude: "do second step", outcome: "proof" };
  for (const mode of ["team", "build-review", "codex-plan-claude", "parallel-write"]) {
    const next = swapTeamAssignment(mode, roles);
    assert.equal(workflowFamily(next.mode), mode);
    assert.equal(teamWorkflowMode(mode, "claude"), next.mode);
    assert.deepEqual(routeMode(next.mode, {}).requested, ["claude", "codex"]);
    assert.equal(next.teamwork.claude, roles.codex);
    assert.equal(next.teamwork.codex, roles.claude);
    assert.deepEqual(swapTeamAssignment(next.mode, next.teamwork), { mode, teamwork: roles });
  }
  assert.equal(swapTeamAssignment("codex", roles), null);
  assert.deepEqual(effectiveTeamwork({}, { teamwork: roles }, { codex: "project" }), {});
  assert.equal(effectiveTeamwork(undefined, { teamwork: roles }, { codex: "project" }), roles);
});

test("draft defaults skip one-message overrides and continuation runs", () => {
  const { defaultDraftMode, handoffTeamwork } = require("../desktop/collaboration.mjs");
  const runHistory = [{ mode: "team" }, { mode: "codex", assignmentOnce: true }, { mode: "claude-write", continuedFrom: "previous" }];
  assert.equal(defaultDraftMode({ runHistory, teamMode: "build-review" }), "team");
  assert.equal(defaultDraftMode({ runHistory, teamMode: "build-review", teamAssignment: { inherit: true } }), "build-review");
  assert.equal(defaultDraftMode({ runHistory, teamAssignment: { mode: "claude-team" } }), "claude-team");
  assert.equal(defaultDraftMode({ runHistory: runHistory.slice(1) }), "team");
  assert.deepEqual(handoffTeamwork({ brief: "shared", codex: "Build and verify", claude: "Review only" }, "codex", "claude"),
    { brief: "shared", codex: "Build and verify", claude: "Build and verify" });
});
