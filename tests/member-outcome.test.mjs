import test from "node:test";
import assert from "node:assert/strict";
import { memberStatusNote, memberUsageNote } from "../desktop/member-outcome.mjs";
import history from "../desktop/run-history.cjs";

const run = () => ({ mode: "session-team", sessionTeam: { members: [{ id: "a", name: "Codex" }, { id: "b", name: "Claude Code" }] },
  agents: { a: { status: "interrupted", providerCalls: 1 }, b: { status: "skipped" } } });

test("A saved stopped team explains the unstarted reviewer without inventing zero token usage", () => {
  const saved = run();
  assert.match(memberStatusNote(saved, "b"), /Codex was interrupted/);
  assert.equal(memberUsageNote(saved, "b"), "No model request was sent for this member.");
  saved.agents.b.providerCalls = 1;
  assert.equal(memberUsageNote(saved, "b"), "No usage reported for this run");
  assert.equal(memberStatusNote(saved, "b"), "This stage was skipped after a provider request.");
  assert.equal(saved.agents.b.usage, undefined);
});

test("Branch skips name their direct upstream member and keep explicit failure reasons", () => {
  const saved = run();
  saved.sessionTeam.topology = "tree";
  saved.sessionTeam.members.push({ id: "c", name: "Other branch", parentId: "a" }, { id: "d", name: "Leaf", parentId: "c" });
  saved.agents.c = { status: "limited" };
  saved.agents.d = { status: "skipped" };
  assert.match(memberStatusNote(saved, "d"), /Other branch reached its usage limit/);
  history.recordEvent(saved, "d", { type: "status", status: "skipped", reason: "Model unavailable. Choose a different model." });
  assert.match(memberStatusNote(saved, "d"), /Model unavailable/);
  history.recordEvent(saved, "d", { type: "status", status: "running" });
  assert.equal(memberStatusNote(saved, "d"), "");
});

test("Review policies and unknown legacy outcomes stay distinct from failed teammates", () => {
  const saved = run();
  saved.reviewSkipped = "The unchanged patch already has matching review evidence.";
  assert.equal(memberStatusNote(saved, "b"), saved.reviewSkipped);
  assert.equal(memberStatusNote({ agents: { b: { status: "skipped" } } }, "b"), "This member was not started in this run.");
});
