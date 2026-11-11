import test from "node:test";
import assert from "node:assert/strict";
import { changeTeamDirection, supportsTeamDirection, teamDirection } from "../desktop/team-direction.mjs";
import { defaultDraftMode } from "../desktop/collaboration.mjs";

const codexId = "member-11111111-1111-4111-8111-111111111111";
const claudeId = "member-22222222-2222-4222-8222-222222222222";
const team = { members: [
  { id: codexId, name: "Codex", provider: "codex", model: "codex-model", position: "write", instructions: "Implement and test" },
  { id: claudeId, name: "Claude", provider: "claude", model: "claude-model", position: "review", instructions: "Check actual diff" },
], useByDefault: true, shareReports: true };

test("Swapping a pair keeps models and member IDs with providers and responsibilities with roles", () => {
  const next = changeTeamDirection(team, "claude");
  assert.deepEqual(next.members.map((member) => [member.id, member.model, member.position, member.instructions]), [
    [claudeId, "claude-model", "write", "Implement and test"], [codexId, "codex-model", "review", "Check actual diff"],
  ]);
  assert.equal(team.members[0].provider, "codex");
  assert.equal(teamDirection(next, "session-team"), "claude");
  assert.equal(teamDirection(changeTeamDirection(next, "codex"), "session-team"), "codex");
});

test("Two-way discussion persists on restart and returning to work keeps normal team permission handling", () => {
  const discussion = JSON.parse(JSON.stringify(changeTeamDirection(team, "discuss")));
  assert.equal(defaultDraftMode({ sessionTeam: discussion }), "team-discussion");
  assert.equal(teamDirection(discussion, "team-discussion"), "discuss");
  const work = changeTeamDirection(discussion, "codex");
  assert.equal(defaultDraftMode({ sessionTeam: work }), "session-team");
  assert.equal(work.interaction, undefined);
  assert.equal(work.shareReports, true);
});

test("Quick pair presets do not drop third party members or accept an unknown workflow", () => {
  const custom = { ...team, members: [...team.members, { id: "extra", provider: "gemini" }] };
  assert.equal(supportsTeamDirection(custom), false);
  assert.throws(() => changeTeamDirection(custom, "codex"), /Session Team/);
  assert.throws(() => changeTeamDirection(team, "unlimited"), /supported/);
});
