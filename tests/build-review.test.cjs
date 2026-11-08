const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const { runFlow } = require("../desktop/team-flow.cjs");
const { reviewSnapshot, changedReviewPaths } = require("../desktop/review-snapshot.cjs");
const { newRun, finishRun } = require("../desktop/run-history.cjs");

test("build-review captures the diff only after Codex completes", async () => {
  const order = [];
  let completeCodex;
  const codex = new Promise((resolve) => { completeCodex = resolve; });
  const finalInput = { hasChanges: true, body: "final diff" };
  const flow = runFlow({
    mode: "build-review", agents: ["codex", "claude"], stopped: () => false,
    runAgent: (agent, input, handoff) => {
      order.push(agent);
      if (agent === "codex") return codex;
      assert.equal(input, finalInput);
      assert.deepEqual(handoff, { from: "codex", kind: "build", text: "Tests passed", status: "completed" });
    },
    readReview: (phase) => { order.push(phase); return finalInput; },
    skipReview: assert.fail,
  });
  assert.deepEqual(order, ["codex"]);
  completeCodex({ status: "completed", output: "Tests passed" });
  await flow;
  assert.deepEqual(order, ["codex", "after-build", "claude"]);
});

test("plan-to-implement waits for actual planner output in both directions", async () => {
  for (const [mode, planner, builder] of [
    ["codex-plan-claude", "codex", "claude"],
    ["claude-plan-codex", "claude", "codex"],
  ]) {
    let completePlan;
    const pendingPlan = new Promise((resolve) => { completePlan = resolve; });
    const calls = [];
    const flow = runFlow({
      mode, agents: [planner, builder], stopped: () => false, readReview: assert.fail, skipReview: assert.fail,
      runAgent(agent, review) {
        calls.push(agent);
        assert.equal(agent, planner);
        assert.equal(review, undefined);
        return pendingPlan;
      },
      savePlan(plan) {
        assert.deepEqual(plan, { from: planner, to: builder, state: "ready", text: "Plan artifact" });
        calls.push("saved");
      },
    });
    assert.deepEqual(calls, [planner]);
    completePlan({ status: "completed", output: "AI_DECK_PLAN: READY\nPlan artifact" });
    await flow;
    assert.deepEqual(calls, [planner, "saved"]);
  }
});

test("an incomplete or empty plan never starts the writer", async () => {
  for (const [result, expected] of [
    [{ status: "completed" }, "unclassified"],
    [{ status: "completed", output: "AI_DECK_PLAN: READY\n" }, "unclassified"],
    [{ status: "completed", output: "AI_DECK_PLAN: NEEDS_INPUT\nWhich files?" }, "needs-input"],
    [{ status: "limited", output: "AI_DECK_PLAN: READY\nPartial plan" }, "blocked"],
    [{ status: "failed" }, "blocked"],
  ]) {
    const calls = [];
    await runFlow({
      mode: "codex-plan-claude", agents: ["codex", "claude"], stopped: () => false, readReview: assert.fail,
      runAgent(agent) { calls.push(agent); return result; },
      savePlan(plan) { assert.equal(plan.state, expected); calls.push("saved"); },
      skipReview: assert.fail,
    });
    assert.deepEqual(calls, ["codex", "saved"]);
  }
});

test("failed, stopped, and unchanged builds never start Claude", async () => {
  for (const [status, stopped, reads, skips] of [
    ["failed", false, 0, 1],
    ["interrupted", true, 0, 0],
    ["completed", false, 1, 1],
    ["completed", true, 0, 0],
  ]) {
    let readCount = 0;
    let skipCount = 0;
    await runFlow({
      mode: "build-review", agents: ["codex", "claude"], stopped: () => stopped,
      runAgent: async (agent) => { assert.equal(agent, "codex"); return { status }; },
      readReview: () => { readCount += 1; return { hasChanges: false }; },
      skipReview: () => { skipCount += 1; },
    });
    assert.equal(readCount, reads);
    assert.equal(skipCount, skips);
  }
});

test("parallel captures the initial input and starts both agents without waiting for completion", async () => {
  const order = [];
  let resolveCodex;
  const codex = new Promise((resolve) => { resolveCodex = resolve; });
  const initialInput = { hasChanges: false };
  const flow = runFlow({
    mode: "team", agents: ["codex", "claude"], stopped: () => false,
    readReview: (phase) => { order.push(phase); return initialInput; },
    runAgent: (agent, input) => {
      order.push(agent);
      if (agent === "codex") return codex;
      assert.equal(input, initialInput);
    },
    skipReview: assert.fail,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["before-run", "codex", "claude"]);
  resolveCodex();
  await flow;
});

test("Low RAM preserves team review input and waits for the previous agent", async () => {
  for (const stopDuringCodex of [false, true]) {
    const order = [];
    const snapshot = { hasChanges: true };
    let releaseCodex;
    const codex = new Promise((resolve) => { releaseCodex = resolve; });
    let stopped = false;
    const flow = runFlow({
      mode: "team", agents: ["codex", "claude"], lowMemory: true,
      stopped: () => stopped,
      readReview(phase) { assert.equal(phase, "before-run"); return snapshot; },
      runAgent(agent, input) {
        order.push(agent);
        if (agent === "codex") return codex;
        assert.equal(input, snapshot);
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["codex"]);
    stopped = stopDuringCodex;
    releaseCodex();
    await flow;
    assert.deepEqual(order, stopDuringCodex ? ["codex"] : ["codex", "claude"]);
  }
});

test("review records a digest for the actual bytes and adds only eligible source files on opt-in", (t) => {
  const root = fs.mkdtempSync(path.join(__dirname, "review-fixture-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), __dirname);
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, "new.ts"), "export const retry = 3;");
  fs.writeFileSync(path.join(root, "secrets.ts"), "example sensitive fixture");
  fs.writeFileSync(path.join(root, "binary.ts"), Buffer.from([0xff, 0x00]));
  fs.writeFileSync(path.join(root, "large.ts"), "x".repeat(8001));
  const input = {
    cwd: root, base: "base-sha", head: "head-sha", diff: "a".repeat(32001), status: "?? new.ts",
    tracked: "old.ts", untracked: ["new.ts", "secrets.ts", "binary.ts", "large.ts"].join("\0") + "\0",
    phase: "after-build",
  };
  const noShare = reviewSnapshot({ ...input, includeNew: false });
  assert.deepEqual(noShare.info.addedFiles, []);
  assert.equal(noShare.info.omittedNew, 4);
  assert.doesNotMatch(noShare.body, /export const retry/u);
  const shared = reviewSnapshot({ ...input, includeNew: true });
  assert.deepEqual(shared.info.addedFiles, ["new.ts"]);
  assert.equal(shared.info.omittedNew, 3);
  assert.equal(shared.info.diffTruncated, true);
  assert.equal(shared.info.sha256, createHash("sha256").update(shared.body).digest("hex"));
  assert.doesNotMatch(shared.body, /example sensitive fixture/u);
});

test("an interrupted build-review settles the Claude waiting state", () => {
  const run = newRun("build-review", "Fix retries", ["codex", "claude"]);
  assert.equal(run.agents.claude.status, "queued");
  finishRun(run);
  assert.equal(run.agents.claude.status, "interrupted");
});

test("incremental review includes only changed file patches and keeps the full worktree digest", () => {
  const common = { cwd: process.cwd(), head: "head", base: "base", status: " M a.js\n M b.js", tracked: "a.js\nb.js",
    untracked: "", phase: "before-run", names: "a.js\0b.js\0" };
  const a = "diff --git a/a.js b/a.js\n+stay\n";
  const b = "diff --git a/b.js b/b.js\n+change\n";
  const original = reviewSnapshot({ ...common, diff: a + b });
  const current = { ...common, diff: a + b.replace("change", "changed") };
  const full = reviewSnapshot(current);
  const next = reviewSnapshot({ ...current, since: { id: "review-1", snapshot: original.info } });
  assert.deepEqual(changedReviewPaths(original.info.fileDigests, full.info.fileDigests), ["b.js"]);
  assert.deepEqual(next.info.changedFiles, ["b.js"]);
  assert.match(next.body, /\+changed/);
  assert.doesNotMatch(next.body, /\+stay/);
  assert.notEqual(next.info.sha256, full.info.sha256);
  assert.equal(next.info.worktreeSha256, full.info.worktreeSha256);
  assert.throws(() => reviewSnapshot({ ...common, diff: a + b, since: { id: "review-1", snapshot: original.info } }), /No changed files/);
});
test("the reverse flow snapshots Claude edits before running a Codex review", async () => {
  const order = [];
  const snapshot = { hasChanges: true, body: "+ new file" };
  await runFlow({
    mode: "claude-build-review", agents: ["claude", "codex"], stopped: () => false,
    async runAgent(agent, review) { order.push([agent, review]); return { status: "completed" }; },
    async readReview(phase, reviewer) { order.push([phase, reviewer]); return snapshot; },
    skipReview() { throw new Error("The review should run"); },
  });
  assert.deepEqual(order, [["claude", undefined], ["after-build", "codex"], ["codex", snapshot]]);
});

test("a standalone Codex review receives the current snapshot as a reviewer", async () => {
  const snapshot = { hasChanges: true, body: "+ fixed retry" };
  await runFlow({
    mode: "codex-review", agents: ["codex"], stopped: () => false,
    async readReview(phase, reviewer) {
      assert.equal(phase, "before-run");
      assert.equal(reviewer, "codex");
      return snapshot;
    },
    async runAgent(agent, review) {
      assert.equal(agent, "codex");
      assert.equal(review, snapshot);
    },
  });
});

test("the swapped shared-task workflow gives Codex the initial snapshot and runs Claude first in Low RAM", async () => {
  const order = [];
  const initial = { hasChanges: true, body: "initial diff" };
  await runFlow({ mode: "claude-team", agents: ["claude", "codex"], lowMemory: true, stopped: () => false,
    readReview(phase, reviewer) { order.push([phase, reviewer]); return initial; },
    async runAgent(agent, review) { order.push([agent, review]); },
    skipReview() { assert.fail("unexpected skipped review"); },
  });
  assert.deepEqual(order, [["before-run", "codex"], ["claude", undefined], ["codex", initial]]);
});
