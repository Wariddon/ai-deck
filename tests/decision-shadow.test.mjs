import assert from "node:assert/strict";
import test from "node:test";
import { decideGraph, decideIntent, decideReview, fallbackMessageIntent, resolvedCheckNote, routeLocalIntent } from "../desktop/decision-shadow.mjs";
import { verifiedTeamSummary } from "../desktop/team-result.mjs";

test("a resolved note closes only with the exact, passing review evidence", () => {
  const check = { freshness: "matched", exitCode: 0, command: "node --test" };
  const run = { reviewSnapshot: { sha256: "current", phase: "after-build" }, collaboration: { verdict: "pass",
    reviewObservation: { stamp: "worktree" },
    findings: "R1 PASS — Test passed.\nCaveat: the handoff's R3 line says the check ID was unavailable, but recorded check E1 supplies it.",
    criteria: [{ id: "R1" }], criterionResults: [{ id: "R1", status: "pass", detail: "Test passed.", evidence: { snapshot: "current" } }],
    handoffs: [{ sent: true, sha256: "current", checks: [check] }] } };
  assert.equal(decideReview(run, true).decision, "finish");
  assert.equal(verifiedTeamSummary(run), "R1 · Test passed.");
  assert.equal(resolvedCheckNote("RESOLVED_CHECK E2", [check]), false);
  assert.equal(decideReview(run, false).decision, "evidence");
  check.exitCode = 1;
  assert.equal(decideReview(run, true).decision, "repair");
  assert.equal(verifiedTeamSummary(run), undefined);
  check.exitCode = 0;
  check.freshness = "changed";
  assert.equal(decideReview(run, true).decision, "evidence");
  check.freshness = "matched";
  run.collaboration.findings += "\nThe migration could drop data.";
  assert.equal(decideReview(run, true).decision, "summarize");
  assert.equal(verifiedTeamSummary(run), undefined);
});

test("graph and intent decisions abstain when evidence is missing or conflicting", () => {
  const graph = { rows: [{ kind: "definition", file: "layout.ts" }, { kind: "imports", file: "page.ts" }] };
  assert.equal(decideGraph("Find callers", graph).decision, "expand_callers");
  graph.rows.push({ kind: "calls", file: "page.ts" });
  assert.equal(decideGraph("Check the tests", graph).decision, "read_tests");
  assert.equal(decideGraph("Find callers", graph).decision, "use");
  assert.equal(decideGraph("Find callers", { ...graph, ambiguous: true }).decision, "uncertain");
  assert.equal(decideIntent("ทำเลย").decision, "clarify");
  assert.equal(decideIntent("ทำเลย", { reply: "ผมจะปรับไฟล์ layout.ts" }).decision, "edit");
  assert.equal(decideIntent("ตรวจโค้ด แต่อย่าแก้ไฟล์").decision, "review");
  assert.equal(decideIntent("fix or explain the issue").decision, "clarify");
});

test("active intent routing requires a direct edit instruction and leaves ambiguous approvals to the user", () => {
  assert.equal(routeLocalIntent("Edit only layout.mjs. Inspect the callers first. Don't run tests yourself.").decision, "edit");
  assert.equal(routeLocalIntent("Explain why the caller can crash.").decision, "chat");
  assert.equal(routeLocalIntent("ตรวจโค้ด แต่อย่าแก้ไฟล์").decision, "review");
  assert.equal(routeLocalIntent("ทำเลย", { reply: "ผมจะปรับไฟล์ layout.ts" }).decision, "clarify");
  assert.equal(routeLocalIntent("Example from a comment. Edit config.js.").decision, "clarify");
  assert.equal(routeLocalIntent("Edit config.js or explain what changed.").decision, "clarify");
  assert.equal(routeLocalIntent("ตรวจสอบอีกทีจะปรับอะไรได้อีก ปรับแก้ได้").decision, "edit");
  assert.equal(routeLocalIntent("ตรวจสอบก่อน ยังไม่ต้องปรับ แม้ปรับแก้ได้").decision, "review");
  assert.equal(fallbackMessageIntent("ตรวจสอบอีกทีจะปรับอะไรได้อีก").decision, "review");
  assert.equal(fallbackMessageIntent("ทำเลย").decision, "chat");
});
