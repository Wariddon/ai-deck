const assert = require("node:assert/strict");
const { test } = require("node:test");
const { claudeLimitEvent, codexLimit, textLimit } = require("../desktop/usage-limit.cjs");
const { routeMode } = require("../desktop/usage-routing.mjs");
const { runFlow } = require("../desktop/team-flow.cjs");

test("only provider-confirmed usage failures hold a connection", () => {
  const reset = Math.floor(Date.now() / 1000) + 3600;
  const reached = codexLimit({ codexErrorInfo: "usageLimitExceeded" }, {
    primary: { usedPercent: 100, resetsAt: reset },
    secondary: { usedPercent: 47, resetsAt: reset + 100 },
  });
  assert.equal(reached.kind, "usage");
  assert.equal(reached.resetAt, reset * 1000);
  assert.equal(codexLimit({ codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 429 } }, message: "Too many requests" }), null);
  assert.equal(textLimit("You have hit your context limit"), null);
  assert.equal(claudeLimitEvent({ status: "allowed_warning", resetsAt: reset }), null);
  assert.equal(claudeLimitEvent({ status: "rejected", resetsAt: reset }).resetAt, reset * 1000);
  assert.equal(claudeLimitEvent({ status: "rejected", errorCode: "credits_required", resetsAt: reset }).resetAt, null);
});

test("team routes around one limit, solo never changes provider, and two holds block send", () => {
  const now = 1234567;
  const ready = { status: "ready" };
  const limited = { ...ready, usageLimit: { kind: "usage", resetAt: now + 5000 } };
  assert.deepEqual(routeMode("team", { codex: ready, claude: limited }, now).available, ["codex"]);
  assert.deepEqual(routeMode("build-review", { codex: limited, claude: ready }, now).available, ["claude"]);
  assert.deepEqual(routeMode("claude", { codex: ready, claude: limited }, now).available, []);
  assert.deepEqual(routeMode("team", { codex: limited, claude: limited }, now).available, []);
  assert.deepEqual(routeMode("team", { codex: limited, claude: { status: "signIn" } }, now).disconnected, ["claude"]);
  assert.deepEqual(routeMode("team", { codex: limited, claude: ready }, now + 5000).available, ["codex", "claude"]);
});

test("build-review uses Claude read-only after Codex reaches its limit, even without a diff", async () => {
  const order = [];
  await runFlow({
    mode: "build-review", agents: ["codex", "claude"], stopped: () => false,
    runAgent: async (agent) => { order.push(agent); return { status: "limited" }; },
    readReview: (phase) => { order.push(phase); return { hasChanges: false }; },
    skipReview: assert.fail,
  });
  assert.deepEqual(order, ["codex", "fallback", "claude"]);
});

test("known Claude limit avoids both its process and review capture", async () => {
  for (const mode of ["team", "build-review"]) {
    const order = [];
    await runFlow({
      mode, agents: ["codex", "claude"], available: ["codex"], stopped: () => false,
      runAgent: async (agent) => { order.push(agent); return { status: "completed" }; },
      readReview: assert.fail, skipReview: assert.fail,
    });
    assert.deepEqual(order, ["codex"]);
  }
});
test("a limited writer can hand off only the latest finished run on a writable worktree", async () => {
  const { continuationFor } = await import("../desktop/usage-routing.mjs");
  const run = { id: "limited-build", mode: "claude-build-review", finishedAt: "2026-11-08",
    agents: { claude: { status: "limited" }, codex: { status: "completed" } } };
  const workspace = { worktree: "worktree", runHistory: [run] };
  assert.deepEqual(continuationFor(workspace), {
    runId: run.id, kind: "usage-handoff", from: "claude", agent: "codex", mode: "codex",
  });
  assert.equal(continuationFor({ ...workspace, readOnly: true }), null);
  assert.equal(continuationFor({ ...workspace, runHistory: [run, { ...run, id: "running", finishedAt: null }] }), null);
  assert.equal(continuationFor({ ...workspace, runHistory: [{ ...run, mode: "parallel-write" }] }), null);
});

test("an available planner may produce a plan while the writer is limited", async () => {
  const { continuationFor } = await import("../desktop/usage-routing.mjs");
  const mode = "codex-plan-claude";
  const ready = { status: "ready" };
  const limited = { ...ready, usageLimit: { kind: "usage", resetAt: null } };
  assert.deepEqual(routeMode(mode, { codex: ready, claude: limited }).available, ["codex"]);
  assert.deepEqual(routeMode(mode, { codex: limited, claude: ready }).available, []);
  const run = { id: "plan", mode, finishedAt: "2026-11-08", agents: {
    codex: { status: "completed", messages: [{ text: "Plan artifact" }] }, claude: { status: "limited" },
  } };
  assert.deepEqual(continuationFor({ worktree: "worktree", runHistory: [run] }), {
    runId: "plan", kind: "apply-team-plan", from: "codex", agent: "claude", mode: "claude-write",
  });
});

test("a saved plan survives later turns without hiding a newer usage handoff", async () => {
  const { continuationFor } = await import("../desktop/usage-routing.mjs");
  const plan = { id: "ready", finishedAt: "time", mode: "codex-plan-claude",
    teamPlan: { state: "ready", from: "codex", to: "claude", worktree: "lane", base: "sha" } };
  const newer = { id: "limited", finishedAt: "time", mode: "codex", agents: { codex: { status: "limited" } } };
  const workspace = { worktree: "lane", base: "sha", runHistory: [plan, newer] };
  assert.equal(continuationFor(workspace).runId, "limited");
  assert.equal(continuationFor(workspace, "ready").runId, "ready");
  assert.equal(continuationFor({ ...workspace, base: "new" }, "ready"), null);
  assert.equal(continuationFor({ ...workspace, runHistory: [plan, { ...newer, agents: { codex: { status: "completed" } } }] }).runId, "ready");
  plan.teamPlan.applyStatus = "completed";
  assert.equal(continuationFor(workspace, "ready"), null);
});
