import { test } from "node:test";
import assert from "node:assert/strict";
import { readWorkContract, workContractPrompt } from "../desktop/work-contract.mjs";
import { classifyTeamPlan } from "../desktop/collaboration.mjs";
import { parsePlan, executeAutoTeam } from "../desktop/auto-team.cjs";
import { restoreWorkspace } from "../desktop/run-history.cjs";
import { visibleTeamAnswer } from "../desktop/team-result.mjs";
import { normalizeSessionTeam, sessionMemberInputs, sessionMemberPrompt } from "../desktop/session-team.mjs";

const contract = name => ({ inputs: [name + " input interface"], outputs: [name + " artifact and check evidence"], readyWhen: [name + " output matches its interface; missing evidence is explicit"] });
const assignment = (name, paths) => ({ task: name, paths, acceptance: [name + " observable behavior"], ...contract(name) });
const ready = plan => classifyTeamPlan({ status: "completed", output: "AI_DECK_PLAN: READY\n" + JSON.stringify(plan) });

test("structured plans preserve exact contracts, reject malformed prerequisites and retain legacy prose", () => {
  const source = { summary: "Edit service.js and verify its API", ...contract("current") };
  const parsed = ready(source);
  assert.deepEqual(parsed, { state: "ready", text: source.summary, ...contract("current") });
  const visible = visibleTeamAnswer({ mode: "codex-plan-claude", teamPlan: { ...parsed, from: "codex" }, agents: {} });
  assert.ok(visible.text.includes(parsed.outputs[0]));
  assert.doesNotMatch(visible.text, /AI_DECK_PLAN|"summary":/u);
  source.inputs.push("later mutation");
  assert.equal(parsed.inputs.length, 1);
  assert.deepEqual(readWorkContract({ inputs: [" API ", "API"], readyWhen: [] }), { inputs: ["API"], readyWhen: [] });
  for (const inputs of ["dependency", null, [""], ["x".repeat(301)], Array(7).fill("dependency")]) {
    assert.equal(ready({ summary: "Do work", inputs }).state, "unclassified");
    assert.equal(parsePlan("AI_DECK_AUTO: CODEX\n" + JSON.stringify({ summary: "Do work", assignments: {
      codex: { ...assignment("writer", ["service.js"]), inputs }, claude: assignment("reviewer", []),
    } }), true).state, "unclassified");
  }
  assert.deepEqual(classifyTeamPlan({ status: "completed", output: "AI_DECK_PLAN: READY\nLegacy plan" }), { state: "ready", text: "Legacy plan" });
  assert.equal(ready({ summary: "Do work", readyWhen: ["check the API"] }).state, "ready", "Readiness criteria are requirements, not automatic pass evidence");
});

test("saved Auto Team contracts survive serialization and workspace recovery without changing earlier plans", () => {
  const assignments = { codex: assignment("writer", ["service.js"]), claude: assignment("reviewer", []) };
  const plan = parsePlan("AI_DECK_AUTO: CODEX\n" + JSON.stringify({ summary: "Implement API", assignments }), true);
  assert.deepEqual(plan.assignments, assignments);
  const workspace = { runHistory: [{ id: "one", finishedAt: "saved", agents: {}, teamPlan: plan }] };
  assert.deepEqual(restoreWorkspace(JSON.parse(JSON.stringify(workspace))).runHistory[0].teamPlan, plan);
  const legacy = structuredClone(assignments);
  for (const entry of Object.values(legacy)) for (const key of ["inputs", "outputs", "readyWhen"]) delete entry[key];
  assert.deepEqual(parsePlan("AI_DECK_AUTO: CODEX\n" + JSON.stringify({ summary: "Old plan", assignments: legacy }), true).assignments, legacy);
});

test("both role orders hand contracts to the reviewer and resume a limited review without repeating implementation", async () => {
  for (const builder of ["codex", "claude"]) {
    const reviewer = builder === "codex" ? "claude" : "codex";
    const state = { results: {} }, calls = [];
    const plan = { strategy: "single", builder, assignments: { [builder]: assignment(builder, ["service.js"]), [reviewer]: assignment(reviewer, []) } };
    let limited = true;
    const flow = { state, plan, stopped: () => false, checkpoint() {}, progress() {},
      reviewInput: async () => ({ checks: "current recorded check", review: "current diff" }),
      turn: async (agent, stage) => {
        calls.push([agent, stage.role]);
        assert.ok(stage.instructions.includes(plan.assignments[builder].outputs[0]));
        assert.ok(stage.instructions.includes(plan.assignments[builder].readyWhen[0]));
        if (stage.role === "review") {
          assert.ok(stage.instructions.includes(plan.assignments[reviewer].inputs[0]));
          if (limited) return { status: "limited" };
          assert.equal(stage.handoff.text, "Output saved; one check remains unknown");
          return { status: "completed", output: "AI_DECK_REVIEW: BLOCKED\nThe required check remains unknown." };
        }
        return { status: "completed", output: "Output saved; one check remains unknown" };
      } };
    assert.equal((await executeAutoTeam(flow)).status, "limited");
    limited = false;
    assert.equal((await executeAutoTeam(flow)).status, "blocked");
    assert.deepEqual(calls, [[builder, "write"], [reviewer, "review"], [reviewer, "review"]]);
    assert.equal(state.results[builder + "-build"].text, "Output saved; one check remains unknown");
  }
});

test("split reviews receive the correct lane contract and integration receives both without extra calls", async () => {
  const plan = { strategy: "split", builder: "codex", assignments: {
    codex: assignment("alpha", ["alpha.js"]), claude: assignment("beta", ["beta.js"]),
  } }, calls = [];
  const result = await executeAutoTeam({ state: { results: {} }, plan, lowMemory: true, stopped: () => false, checkpoint() {}, progress() {},
    reviewInput: async () => ({ checks: "current checks" }), combine: verify => verify({ review: "combined checkout" }),
    turn: async (agent, stage) => {
      calls.push(agent);
      for (const [lane, entry] of Object.entries(plan.assignments)) {
        assert.equal(stage.instructions.includes(entry.readyWhen[0]), !stage.lane || stage.lane === lane);
      }
      return { status: "completed", output: stage.role === "review" ? "AI_DECK_REVIEW: PASS\nVerified the supplied artifact." : "Artifact saved" };
    } });
  assert.equal(result.status, "reviewed");
  assert.equal(calls.length, 5);
});

test("Session Team forwards contracts under existing report-sharing rules with no private-field bypass", () => {
  const member = { id: "reviewer", provider: "claude", name: "Reviewer", position: "review" };
  const source = { name: "Planner", text: "Summary", projectData: true, contract: contract("private-plan") };
  const team = normalizeSessionTeam({ members: [{ ...member, id: "member-00000000-0000-4000-8000-000000000001" }] });
  const input = { team, userPrompt: "Check API", projectPrompt: "Project", handoffs: [source] };
  const received = sessionMemberInputs({ ...input, member });
  assert.ok(sessionMemberPrompt({ member, members: [member], ...received }).includes(source.contract.readyWhen[0]));
  const external = { ...member, provider: "gemini", instructions: "" };
  const withheld = sessionMemberInputs({ ...input, member: external });
  assert.doesNotMatch(sessionMemberPrompt({ member: external, members: [external], ...withheld }), /private-plan/u);
  assert.equal(workContractPrompt(undefined), "");
});
