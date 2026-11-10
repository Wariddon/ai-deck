const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeTeamwork, selectedContext, steerableDraft, steerMode, teamInstructions, agentRole } = require("../desktop/collaboration.mjs");

test("a follow-up can target a separate-edits run without changing its scope", () => {
  const mode = steerMode({ mode: "parallel-write" });
  assert.equal(mode, "parallel-write");
  const draft = { mode, prompt: "Also check the boundary case" };
  assert.equal(steerableDraft(draft, mode), true);
  assert.equal(steerableDraft({ ...draft, mode: "codex" }, mode), false);
  assert.equal(steerableDraft({ ...draft, reviewFiles: [] }, mode), false);
  assert.equal(steerableDraft({ ...draft, teamwork: {} }, mode), false);
  assert.equal(steerMode({ mode: "auto-team" }), null);
  assert.equal(steerMode({ mode: "parallel-write", continuedFrom: "approved-run" }), null);
});

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
  const runHistory = [{ mode: "team" }, { mode: "codex", assignmentOnce: true }, { mode: "claude-write", continuedFrom: "previous" },
    { mode: "claude", collaboration: { resumedFrom: "previous" } }];
  assert.equal(defaultDraftMode({ runHistory, teamMode: "build-review" }), "build-review");
  assert.equal(defaultDraftMode({ runHistory, teamMode: "build-review", teamAssignment: { inherit: true } }), "build-review");
  assert.equal(defaultDraftMode({ runHistory, teamAssignment: { mode: "claude-team" } }), "claude-team");
  assert.equal(defaultDraftMode({ runHistory: runHistory.slice(1) }), "build-review");
  assert.deepEqual(handoffTeamwork({ brief: "shared", codex: "Build and verify", claude: "Review only" }, "codex", "claude"),
    { brief: "shared", codex: "Build and verify", claude: "Build and verify" });
});

test("an empty legacy parallel checkpoint cannot override the team default", () => {
  const { legacyEmptyDraftMode } = require("../desktop/collaboration.mjs");
  const recoveryDraft = { draft: { mode: "team", prompt: "" } };
  const workspace = { recoveryDraft, runHistory: [{ mode: "team" }] };
  assert.equal(legacyEmptyDraftMode(workspace), "build-review");
  assert.equal(legacyEmptyDraftMode({ ...workspace, teamAssignment: { mode: "team" } }), undefined);
  assert.equal(legacyEmptyDraftMode({ ...workspace, recoveryDraft: { ...recoveryDraft, draftRevision: 1 } }), undefined);
  assert.equal(legacyEmptyDraftMode({ ...workspace, recoveryDraft: { draft: { mode: "team", prompt: "Keep this draft" } } }), undefined);
});

test("short Thai conversation requests bypass implementation while mixed coding prompts stay in their workflow", () => {
  const { teamConversation } = require("../desktop/collaboration.mjs");
  const mode = "team";
  assert.equal(teamConversation({ mode, prompt: "ลองคุยกันหน่อยได้ไหม" }), "discussion");
  assert.equal(teamConversation({ mode, prompt: "ให้มันคุยกัน" }), "discussion");
  assert.equal(teamConversation({ mode, prompt: "ผมแค่ให้มันคุยกัน" }), "discussion");
  assert.equal(teamConversation({ mode, prompt: "ให้ทั้งคู่คุยกันเองนะ" }), "discussion");
  assert.equal(teamConversation({ mode, prompt: "ให้ Codex กับ Claude Code คุยกันหน่อย" }), "discussion");
  assert.equal(teamConversation({ mode, prompt: "คุยกัน: ควรตรวจ diff หรือผลเทสต์ก่อน" }), "discussion");
  assert.equal(teamConversation({ mode, prompt: "คุยกันต่อ: แล้วถ้าผลเทสต์ยังไม่มีล่ะ" }), "discussion");
  assert.equal(teamConversation({ mode, prompt: "คุยกันต่อครับ" }), "discussion");
  assert.equal(teamConversation({ mode, prompt: "คุยกันต่อ: แล้วแก้ bug ในรายงานนี้", followupRunId: "previous" }), undefined);
  assert.equal(teamConversation({ mode, prompt: "ให้ทั้งคู่คุยกันเรื่องแผนแก้บั๊กแล้วลงมือ" }), undefined);
  assert.equal(teamConversation({ mode, prompt: "ทั้งสองคนสบายดีไหม" }), "discussion");
  assert.equal(teamConversation({ mode, prompt: "สวัสดีสบายดีไหม" }), "greeting");
  assert.equal(teamConversation({ mode, prompt: "สวัสดีครับ ช่วยแก้ api.js" }), undefined);
  assert.equal(teamConversation({ mode, prompt: "ลองคุยกันหน่อยได้ไหม แล้วแก้ api.js" }), undefined);
  assert.equal(teamConversation({ mode: "team-discussion", prompt: "Discuss the alternative designs." }), "discussion");
});

test("separate edits require different responsibilities for both providers", () => {
  const { separateEditsIssue } = require("../desktop/collaboration.mjs");
  const { separateWriteScopes, laneScopeResult } = require("../desktop/team-paths.mjs");
  const roles = { codex: "Implement the API", claude: "Add UI coverage" };
  const assigned = { ...roles, codexPaths: "src/api/\nsrc/routes.js", claudePaths: "tests/" };
  assert.match(separateEditsIssue("parallel-write", {}), /different responsibilities/u);
  assert.match(separateEditsIssue("claude-parallel-write", { codex: "Fix tests", claude: "fix   tests" }), /different responsibilities/u);
  assert.match(separateEditsIssue("parallel-write", roles), /repository-relative paths/u);
  assert.equal(separateEditsIssue("parallel-write", assigned), "");
  assert.match(separateEditsIssue("parallel-write", { ...assigned, claudePaths: "SRC/api/entry.js" }), /Both writers claim src\/api/u);
  assert.match(separateEditsIssue("parallel-write", { ...assigned, claudePaths: "../secrets.txt" }), /repository-relative paths/u);
  const paths = separateWriteScopes(assigned);
  const snapshot = { head: "base", branch: "", stamp: "worktree", staged: "index" };
  assert.deepEqual(laneScopeResult(paths.codex, snapshot, snapshot, ["src/api/new.js"]), { changed: ["src/api/new.js"] });
  assert.deepEqual(laneScopeResult(paths.codex, snapshot, snapshot, ["tests/shared.js"]).outside, ["tests/shared.js"]);
  assert.match(laneScopeResult(paths.codex, snapshot, { ...snapshot, staged: "changed" }, []).issue, /staging changed/u);
  assert.equal(separateEditsIssue("build-review", {}), "");
});

test("only standalone greetings qualify for one lightweight team reply", () => {
  const { isTeamGreeting } = require("../desktop/collaboration.mjs");
  for (const text of ["สวัสดีทีมฉัน", "สวัสดีครับ ทีมฉัน", "Hello, team 👋", "Hi!"]) assert.equal(isTeamGreeting(text), true);
  for (const text of ["สวัสดี ช่วยแก้ไฟล์", "Hi team, please review", "hello world", "Hello\nrun tests"]) assert.equal(isTeamGreeting(text), false);
});
