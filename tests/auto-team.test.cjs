const test = require("node:test");
const assert = require("node:assert/strict");
const { sharedCheckSource, validateRequiredChecks, formatRequiredChecks } = require("../desktop/team-contract.cjs");
const { planAutoTeam, executeAutoTeam, parsePlan, reviewResult } = require("../desktop/auto-team.cjs");
const { continuationFor, routeMode, singleAgentFallback } = require("../desktop/usage-routing.mjs");
const { newRun, finishRun, restoreWorkspace } = require("../desktop/run-history.cjs");

test("adjacent configured checks share a result only with matching commands and both owners opting in", () => {
  const checks = validateRequiredChecks([
    { name: "Codex fixture", owner: "codex", command: "node --test", shareResult: true },
    { name: "Claude fixture", owner: "claude", command: "node --test", shareResult: true },
    { name: "Independent fixture", owner: "claude", command: "node --test" },
  ]);
  const results = [{ name: "Codex fixture", status: "passed", code: 0, output: "1 passed" }];
  assert.equal(sharedCheckSource(checks, results, 1), "Codex fixture");
  assert.equal(sharedCheckSource(checks, [{ ...results[0], status: "cancelled" }], 1), undefined);
  assert.equal(sharedCheckSource(checks, results, 2), undefined);
  assert.equal(sharedCheckSource([{ ...checks[0], command: "node --test other.cjs" }, checks[1]], results, 1), undefined);
  results.push({ name: "Claude fixture", status: "passed", code: 0, sharedFrom: "Codex fixture" });
  assert.equal(formatRequiredChecks(results).match(/1 passed/g).length, 1);
});

const done = (output) => ({ status: "completed", output });
const pass = done("AI_DECK_REVIEW: PASS\nInspected the diff.");
const changes = done("AI_DECK_REVIEW: CHANGES\nPreserve existing configuration.");
const state = () => ({ results: {} });
const assignment = (task, paths) => ({ task, paths, acceptance: ["Verify the agreed result"] });
const planText = (mode, codex, claude) => "AI_DECK_AUTO: " + mode + "\n" +
  JSON.stringify({ summary: "Implement and verify", assignments: { codex, claude } });

function flow(turn, extra = {}) {
  return { state: state(), turn, progress() {}, checkpoint() {}, stopped: () => false, lowMemory: true,
    reviewInput: async (lane) => ({ review: "diff from " + lane, checks: "recorded npm test result" }),
    combine: async (verify) => verify({ review: "combined diff" }), ...extra };
}

test("planning passes Codex’s proposal to Claude read-only, then yields an approval decision", async () => {
  const calls = [];
  const result = await planAutoTeam(flow(async (agent, options) => {
    calls.push([agent, options.role, options.handoff?.text]);
    return done(agent === "codex" ? "Write and check the UI." : planText("CLAUDE", assignment("Review", []), assignment("Implement", ["src/app.jsx"])));
  }));
  assert.deepEqual(calls, [["codex", "plan", undefined], ["claude", "plan", "Write and check the UI."]]);
  assert.equal(result.status, "approval");
  assert.equal(result.plan.builder, "claude");
  assert.equal(parsePlan("AI_DECK_AUTO: SPLIT\nTwo assignments.", false).state, "blocked");
  assert.equal(parsePlan("Use both providers.", true).state, "unclassified");
});

test("a quota pause preserves the proposal so the second planner can resume alone", async () => {
  const saved = state();
  await planAutoTeam(flow(async (agent) => agent === "codex" ? done("Proposal") : { status: "limited" }, { state: saved }));
  const result = await planAutoTeam(flow(async (agent, stage) => {
    assert.equal(agent, "claude");
    assert.equal(stage.handoff.text, "Proposal");
    return done(planText("CODEX", assignment("Implement", ["src/app.jsx"]), assignment("Review", [])));
  }, { state: saved }));
  assert.equal(result.status, "approval");
});

test("the reviewer receives a fresh diff and test evidence and sends findings back for one revision", async () => {
  const steps = [];
  const result = await executeAutoTeam(flow(async (agent, { role, review, handoff, checks }) => {
    steps.push([agent, role, handoff?.kind]);
    if (role === "write") return done("Updated files");
    assert.equal(review, "diff from claude");
    assert.match(checks, /recorded npm test/);
    return handoff.kind === "revision" ? pass : changes;
  }, { plan: { builder: "claude" } }));
  assert.deepEqual(steps, [
    ["claude", "write", undefined], ["codex", "review", "implementation summary"],
    ["claude", "write", "review findings"], ["codex", "review", "revision"],
  ]);
  assert.equal(result.status, "reviewed");
  assert.equal(reviewResult("Looks fine.").verdict, "blocked");
});

test("second-round findings stop the workflow and a limited review resumes without redoing the build", async () => {
  const saved = state();
  const settings = { state: saved, plan: { builder: "codex" } };
  const paused = await executeAutoTeam(flow(async (_agent, { role }) => role === "write" ? done("Edited files") : { status: "limited" }, settings));
  assert.equal(paused.status, "limited");
  const handoffs = [];
  const result = await executeAutoTeam(flow(async (_agent, { role, handoff }) => {
    handoffs.push(handoff.kind);
    return role === "write" ? done("Fixed files") : changes;
  }, settings));
  assert.deepEqual(handoffs, ["implementation summary", "review findings", "revision"]);
  assert.equal(result.status, "blocked");
});

test("an invalid reviewer response gets one retry using the same evidence", async () => {
  for (const answer of [pass, done("Still missing the marker.")]) {
    const saved = state();
    let attempts = 0;
    const result = await executeAutoTeam(flow(async (_agent, stage) => {
      if (stage.role === "write") return done("Edited.");
      attempts++;
      assert.equal(stage.review, "diff from codex");
      if (attempts === 1) return done("Missing the verdict.");
      assert.match(stage.instructions, /previous response was missing the verdict/u);
      return answer;
    }, { state: saved, plan: { builder: "codex" } }));
    assert.equal(attempts, 2);
    assert.equal(result.status, answer === pass ? "reviewed" : "blocked");
  }
});

test("split assigns each writer a lane, cross-reviews both and then checks the combined diff", async () => {
  const steps = [];
  const result = await executeAutoTeam(flow(async (agent, { lane, role, review }) => {
    steps.push([agent, lane, role, review]);
    return role === "review" ? pass : done("Edited assigned files");
  }, { plan: { strategy: "split", builder: "codex" } }));
  assert.deepEqual(steps, [
    ["codex", "codex", "write", undefined], ["claude", "claude", "write", undefined],
    ["claude", "codex", "review", "diff from codex"], ["codex", "claude", "review", "diff from claude"],
    ["claude", undefined, "review", "combined diff"],
  ]);
  assert.equal(result.status, "reviewed");
});

test("split planning rejects overlapping scopes even when case and path depth differ", () => {
  const response = planText("SPLIT", assignment("Implement API", ["src/Api/"]), assignment("Add UI", ["src/api/index.js"]));
  assert.match(parsePlan(response, true).text, /Both assignments claim/);
  assert.equal(parsePlan(response, true).state, "unclassified");
});

test("a combined check failure sends evidence to the assigned owner and reruns after peer review", async () => {
  const saved = state();
  const steps = [];
  let attempts = 0;
  const result = await executeAutoTeam(flow(async (agent, stage) => {
    steps.push([agent, stage.role, stage.handoff?.kind]);
    if (stage.handoff?.kind === "required checks") {
      assert.equal(agent, "claude");
      assert.deepEqual(stage.scope, ["beta.js"]);
      assert.match(stage.handoff.checks, /expected value · failed · exit 7/);
    }
    return stage.role === "review" ? pass : { ...done("Edited assigned file"), handoff: { files: stage.scope } };
  }, { state: saved, plan: { strategy: "split", builder: "codex", assignments: {
    codex: assignment("Implement alpha", ["alpha.js"]), claude: assignment("Implement beta", ["beta.js"]),
  } }, combine: async (verify) => {
    attempts++;
    saved.requiredChecks = [{ name: "expected value", status: attempts === 1 ? "failed" : "passed", owner: "claude", code: attempts === 1 ? 7 : 0 }];
    return verify({ review: "combined diff", requiredChecks: saved.requiredChecks });
  } }));
  assert.equal(result.status, "reviewed");
  assert.equal(attempts, 2);
  assert.deepEqual(steps.slice(-3), [["claude", "write", "required checks"], ["codex", "review", "required check revision"], ["claude", "review", undefined]]);
  assert.equal(saved.handoffs["claude-check-fix"].to, "claude");
  assert.deepEqual(saved.handoffs["claude-check-fix"].files, ["beta.js"]);
});

test("an unavailable required check blocks completion without asking an agent to repair it", async () => {
  const saved = state();
  const result = await executeAutoTeam(flow(async (_agent, stage) => {
    assert.notEqual(stage.handoff?.kind, "required checks");
    return stage.role === "review" ? pass : done("Edited file");
  }, { state: saved, plan: { builder: "codex" }, verifySingle: async () => {
    saved.requiredChecks = [{ name: "Suite", status: "timed out", owner: "both" }];
  } }));
  assert.equal(result.status, "checks-failed");
});

test("Auto Team requires both providers and resumes a checkpoint only while its plan remains open", () => {
  const ready = { status: "ready" };
  assert.deepEqual(routeMode("auto-team", { codex: ready, claude: ready }).available, ["codex", "claude"]);
  assert.deepEqual(routeMode("auto-team", { codex: ready, claude: { ...ready, usageLimit: {} } }).available, []);
  const plan = { id: "plan", finishedAt: "now", teamPlan: { state: "ready", strategy: "single",
    from: "claude", to: "codex", worktree: "worktree", applyStatus: "limited", applyRunId: "apply" } };
  const apply = { id: "apply", finishedAt: "now", autoTeam: { status: "limited", resume: { main: {} } } };
  const task = { worktree: "worktree", runHistory: [plan, apply] };
  assert.equal(continuationFor(task).resumeRunId, "apply");
  plan.teamPlan.applyStatus = "team-reviewed";
  assert.equal(continuationFor(task), null);
});

test("Auto Team leaves both agents queued until the actual next stage starts", () => {
  const { agents } = newRun("auto-team", "Test", ["codex", "claude"]);
  assert.deepEqual(Object.values(agents).map(({ status }) => status), ["queued", "queued"]);
});

test("closing during Auto Team records an interruption and repairs earlier saved running labels", () => {
  const run = newRun("auto-team", "Test", ["codex", "claude"]);
  run.autoTeam = { status: "running", results: { "codex-build": { text: "checkpoint" } } };
  finishRun(run);
  const ended = run.finishedAt;
  assert.equal(run.autoTeam.status, "interrupted");
  run.autoTeam.status = "running";
  restoreWorkspace({ runHistory: [run] });
  assert.equal(run.finishedAt, ended);
  assert.equal(run.autoTeam.status, "interrupted");
  assert.equal(run.recoveredAfterRestart, true);
  assert.equal(run.autoTeam.results["codex-build"].text, "checkpoint");
});

test("a blocked Auto Team implementation does not hide an earlier plan", () => {
  const teamPlan = { state: "ready", from: "claude", to: "codex", strategy: "single", worktree: "lane" };
  const ready = { id: "ready", finishedAt: "time", teamPlan };
  const blocked = { id: "blocked", finishedAt: "time", teamPlan: { ...teamPlan, applyStatus: "blocked" } };
  const workspace = { worktree: "lane", runHistory: [ready, blocked] };
  assert.equal(continuationFor(workspace, blocked.id), null);
  assert.equal(continuationFor(workspace).runId, ready.id);
});

test("Auto Team falls back to read-only planning when either provider is disconnected", () => {
  const ready = { status: "ready" };
  const missing = { status: "signIn" };
  assert.deepEqual(singleAgentFallback("auto-team", { codex: ready, claude: missing }), { agent: "codex", mode: "codex-plan" });
  assert.deepEqual(singleAgentFallback("auto-team", { codex: missing, claude: ready }), { agent: "claude", mode: "claude-plan" });
});
