const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const { runFlow } = require("../desktop/team-flow.cjs");
const { reviewSnapshot, changedReviewPaths } = require("../desktop/review-snapshot.cjs");
const { newRun, finishRun } = require("../desktop/run-history.cjs");
const { discussionPrompt, previousDiscussion, receiptUsage, recordedSummaryLeader, teamLeaderPrompt, visibleTeamAnswer } = require("../desktop/team-result.mjs");
const { priorTeamResult, teamRunOptions } = require("../desktop/team-handoff.mjs");

test("a legacy team result shows both reports while a new lead reply takes precedence", () => {
  const run = newRun("build-review", "แก้ไฟล์ทดสอบ", ["codex", "claude"]);
  Object.assign(run.agents.codex, { status: "completed", answer: "Updated fixture.txt." });
  Object.assign(run.agents.claude, { status: "completed", answer: "AI_DECK_REVIEW: PASS\nNo actionable findings." });
  run.collaboration = { verdict: "pass" };
  assert.equal(recordedSummaryLeader(run), undefined);
  finishRun(run);
  assert.equal(recordedSummaryLeader(run), "codex");
  assert.deepEqual(visibleTeamAnswer(run), { text: "Updated fixture.txt.", note: "No actionable findings.", noteLabel: "Review" });
  const prompt = teamLeaderPrompt(run, "codex", "node --test · passed · matched");
  for (const evidence of ["แก้ไฟล์ทดสอบ", "Updated fixture.txt.", "No actionable findings.", "passed · matched"]) assert.ok(prompt.includes(evidence));
  assert.equal(prompt.includes("AI_DECK_REVIEW"), false);
  run.collaboration.finalReply = { agent: "codex", text: "Updated and independently reviewed." };
  assert.equal(recordedSummaryLeader(run), undefined);
  assert.deepEqual(visibleTeamAnswer(run), { leader: "Codex", text: "Updated and independently reviewed." });
  assert.equal(visibleTeamAnswer({ ...run, discussion: true }), null);
  assert.equal(teamRunOptions("normal").turnLimit, 3);
  assert.equal(teamRunOptions("normal", { turnLimit: 2 }).turnLimit, 2);
  assert.equal(teamRunOptions("economy").turnLimit, 2);
});

test("the lead receives repeated reviewer findings once and keeps unique evidence", () => {
  const run = newRun("build-review", "Edit fixture", ["codex", "claude"]);
  Object.assign(run.agents.codex, { status: "completed", answer: "Updated the fixture." });
  const report = "Verified the trailing newline. The test passed.";
  Object.assign(run.agents.claude, { status: "completed", answer: "AI_DECK_REVIEW: PASS\n" + report });
  run.collaboration = { verdict: "pass", findings: "Verified the trailing newline." };
  assert.equal(teamLeaderPrompt(run, "codex").split(run.collaboration.findings).length, 2);
  run.collaboration.findings = "The review also recorded a manual check.";
  assert.ok(teamLeaderPrompt(run, "codex").includes(run.collaboration.findings));
});

test("receipts separate automatic summary usage without subtracting manual or unknown usage", () => {
  const usage = { providerCalls: 1, runTokens: { input: 100, output: 5, cached: 90, total: 105, reports: 1 } };
  const run = newRun("build-review", "Edit fixture", ["codex", "claude"]);
  Object.assign(run.agents.codex, {
    providerCalls: 2,
    runTokens: { input: 550, output: 20, cached: 400, total: 570, reports: 2 },
  });
  const final = run.collaboration = { finalReply: { agent: "codex", usage } };
  assert.deepEqual(receiptUsage(run, "codex"), {
    providerCalls: 1, runTokens: { input: 450, output: 15, cached: 310, total: 465, reports: 1 },
  });
  assert.deepEqual(receiptUsage(run, "codex", true), usage);
  assert.equal(receiptUsage(run, "claude"), run.agents.claude);
  final.finalReply.extraUsage = usage;
  assert.equal(receiptUsage(run, "codex"), run.agents.codex);
  final.finalReply = { agent: "codex" };
  assert.equal(receiptUsage(run, "codex").includesSummary, true);
});

test("a discussion relays the opening reply once without reading a Git snapshot", async () => {
  const calls = [];
  await runFlow({
    mode: "team", discussion: true, agents: ["codex", "claude"], stopped: () => false, readReview: assert.fail,
    runAgent: async (agent, review, handoff, stage) => {
      calls.push({ agent, review, handoff, stage });
      return { status: "completed", output: agent === "codex" ? "What do you think, Claude?" : "I agree." };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].agent, "codex");
  assert.equal(calls[1].agent, "claude");
  assert.ok(calls.every(({ review, stage }) => review === undefined && stage.role === "review"));
  assert.deepEqual(calls[1].handoff, { from: "codex", kind: "discussion reply", text: "What do you think, Claude?" });
});

test("discussion follow-up carries only the last completed discussion and never replaces the prior code outcome", () => {
  const code = newRun("build-review", "แก้ fixture", ["codex", "claude"]);
  code.collaboration = { verdict: "pass", findings: "Work verified", handoffs: [] };
  finishRun(code);
  const discussion = newRun("build-review", "คุยกัน: ควรตรวจ diff ก่อนหรือไม่", ["claude", "codex"]);
  discussion.discussion = true;
  discussion.collaboration = { handoffs: [{ kind: "discussion reply" }] };
  Object.assign(discussion.agents.claude, { status: "completed", answer: "เสนอให้ตรวจ diff ก่อน" });
  Object.assign(discussion.agents.codex, { status: "completed", answer: "ตรวจ diff ก่อนและใช้เทสต์ยืนยัน" });
  finishRun(discussion);

  const next = "คุยกันต่อ: ถ้าผลเทสต์ยังไม่มีล่ะ";
  const context = previousDiscussion([code, discussion], next);
  assert.match(context, /ตรวจ diff ก่อนและใช้เทสต์ยืนยัน/u);
  assert.doesNotMatch(context, /Work verified|เสนอให้ตรวจ/u);
  assert.equal(previousDiscussion([code, discussion], "คุยกัน: หัวข้อใหม่"), undefined);
  assert.equal(previousDiscussion([code, discussion], "แล้วถ้าผลเทสต์ยังไม่มีล่ะ", "team-discussion"), context);
  assert.equal(previousDiscussion([code, discussion], "Discuss together: New topic", "team-discussion"), undefined);
  assert.equal(previousDiscussion([discussion, code], next), undefined);
  assert.equal(priorTeamResult([code, discussion], "build-review").text, "Work verified");
  assert.match(discussionPrompt(next, "claude", "codex", context, false), /Claude Code speaking to Codex.*Latest user request/su);
  assert.match(discussionPrompt(next, "codex", "claude", context, true), /specific point or question.*practical answer/su);
  discussion.agents.codex.status = "failed";
  assert.equal(previousDiscussion([code, discussion], next), undefined);
});

test("a material evidence question gets one read-only answer and one recheck, reserving a summary turn", async () => {
  const calls = [];
  const packet = { hasChanges: true, info: { partial: false, includedPaths: ["fixture.txt"] } };
  let verdict;
  await runFlow({
    mode: "build-review", agents: ["codex", "claude"], stopped: () => false,
    policy: "normal", askForEvidence: true, turnsLeft: () => 5 - calls.length,
    readReview: async () => packet, reviewStillCurrent: async () => true, saveVerdict: (value) => { verdict = value; },
    runAgent: async (agent, _packet, handoff, stage) => {
      calls.push({ agent, handoff, stage });
      const output = ["Changed fixture.txt", "AI_DECK_NEEDS_EVIDENCE\nWas the failing case reproduced?",
        "The failing case was reproduced before the fix.", "AI_DECK_REVIEW: PASS\nEvidence confirmed the reproducer."][calls.length - 1];
      return { status: "completed", output };
    },
  });
  assert.deepEqual(calls.map(({ agent }) => agent), ["codex", "claude", "codex", "claude"]);
  assert.equal(calls[2].stage.role, "review");
  assert.equal(calls[2].handoff.text, "Was the failing case reproduced?");
  assert.equal(calls[3].handoff.kind, "evidence reply");
  assert.doesNotMatch(calls[3].stage.instructions, /AI_DECK_NEEDS_EVIDENCE/);
  assert.equal(verdict.verdict, "pass");
});

test("independent checks share one snapshot and overlap only outside Low RAM mode", async () => {
  for (const lowMemory of [true, false]) {
    let running = 0;
    let peak = 0;
    let snapshots = 0;
    const scope = [];
    const packet = {};
    await runFlow({
      mode: "parallel-checks", agents: ["codex", "claude"], lowMemory, stopped: () => false,
      readReview: async () => { snapshots++; return packet; },
      runAgent: async (_agent, review, _handoff, stage) => {
        assert.equal(review, packet);
        assert.equal(stage.role, "review");
        scope.push(stage.instructions);
        peak = Math.max(peak, ++running);
        await new Promise((resolve) => setImmediate(resolve));
        running--;
      },
    });
    assert.equal(snapshots, 1);
    assert.equal(peak, lowMemory ? 1 : 2);
    assert.notEqual(...scope);
  }
});

test("saved team answers retain long reports and reviewer findings", () => {
  const run = newRun("build-review", "Explain the results", ["codex", "claude"]);
  const answer = "Result detail. ".repeat(100) + "Final result.";
  const review = "Review detail. ".repeat(50) + "Final finding.";
  Object.assign(run.agents.codex, { status: "completed", answer });
  Object.assign(run.agents.claude, { status: "completed", answer: review });
  run.collaboration = { handoffs: [] };
  const visible = visibleTeamAnswer(run);
  assert.equal(visible.text, answer);
  assert.equal(visible.note, review);
});

test("separate writers hand off verified progress in serial without an extra turn", async () => {
  for (const lowMemory of [true, false]) {
    const calls = [];
    const receipt = { from: "codex", kind: "lane report", files: ["api.txt"] };
    await runFlow({
      mode: "parallel-write", agents: ["codex", "claude"], lowMemory, stopped: () => false,
      readReview: assert.fail, scopedHandoff: async () => receipt,
      runAgent: async (agent, _review, handoff) => {
        calls.push({ agent, handoff });
        return { status: "completed", output: "Updated the assigned file" };
      },
    });
    assert.deepEqual(calls, [{ agent: "codex", handoff: undefined }, { agent: "claude", handoff: lowMemory ? receipt : undefined }]);
  }
});

test("an explicit no-diff review checks the teammate's report without certifying a Git diff", async () => {
  const { teamStagePrompt } = await import("../desktop/team-handoff.mjs");
  const seen = [];
  await runFlow({
    mode: "build-review", agents: ["codex", "claude"], stopped: () => false, policy: "thorough", alwaysReview: true,
    readReview: async () => ({ hasChanges: false, info: { includedPaths: [] } }),
    reviewStillCurrent: async () => true,
    skipReview: assert.fail,
    runAgent: async (agent, packet, handoff, stage) => {
      seen.push(agent);
      if (agent === "codex") return { status: "completed", output: "I found a missing setup step." };
      assert.equal(packet.peerOnly, true);
      assert.equal(handoff.kind, "peer report");
      assert.match(handoff.text, /missing setup step/u);
      assert.match(teamStagePrompt(agent, stage.role, stage.kind, packet.peerOnly), /Codex owns implementation.*verify without a diff/u);
      return { status: "completed", output: "AI_DECK_REVIEW: PASS\nNo issues in the supplied report." };
    },
    saveVerdict: ({ verdict }) => seen.push(verdict),
  });
  assert.deepEqual(seen, ["codex", "claude", "report"]);
});

test("team review depth caps review, repair and recheck turns", async () => {
  const scenarios = [
    { policy: "economy", hasChanges: false, stages: ["build"] },
    { policy: "normal", stages: ["build", "review"] },
    { policy: "thorough", partial: true, stages: ["build", "review"] },
    { policy: "thorough", stale: true, stages: ["build", "review"], verdict: "blocked" },
    { policy: "thorough", repairWithinScope: false, stages: ["build", "review", "repair"], verdict: "blocked" },
    { policy: "thorough", consumeBudgetDuringRepair: true, stages: ["build", "review", "repair", "paused"] },
    { policy: "thorough", stages: ["build", "review", "repair", "recheck"] },
  ];
  for (const scenario of scenarios) {
    const stages = [];
    const verdicts = [];
    const packet = { hasChanges: scenario.hasChanges ?? true, info: { includedPaths: ["fixture.txt"], partial: scenario.partial } };
    await runFlow({
      mode: "build-review", agents: ["codex", "claude"], stopped: () => false, policy: scenario.policy,
      readReview: async () => packet, skipReview: () => {},
      turnsLeft: () => scenario.consumeBudgetDuringRepair && stages.includes("repair") ? 0 : 4,
      pauseReview: () => stages.push("paused"),
      reviewStillCurrent: async () => !scenario.stale, verifyRepair: async () => scenario.repairWithinScope ?? true,
      saveVerdict: ({ verdict }) => verdicts.push(verdict),
      runAgent: async (agent, _review, handoff, stage) => {
        stages.push(stage?.kind ?? "build");
        if (stage?.kind === "repair") {
          assert.equal(agent, "codex");
          assert.equal(handoff.from, "claude");
          assert.equal(stage.repairOf, packet);
        }
        return { status: "completed", output: agent === "claude" ? "AI_DECK_REVIEW: CHANGES\nFix fixture.txt." : "Changed fixture.txt" };
      },
    });
    assert.deepEqual(stages, scenario.stages);
    assert.equal(verdicts.at(-1), scenario.verdict ?? (stages.includes("review") ? "changes" : undefined));
  }
});

test("compact handoffs omit unrelated dirty paths and flag withheld new changes", async () => {
  const { reviewPolicies } = await import("../desktop/team-handoff.mjs");
  const diff = ["before.txt", "owned.txt"].map((file) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new\n`).join("");
  const input = { head: "head", diff, status: " M before.txt\n M owned.txt", tracked: "before.txt\nowned.txt",
    names: "before.txt\0owned.txt\0", untracked: "prior.txt\0secret.env\0", compact: reviewPolicies.economy };
  const complete = reviewSnapshot({ ...input, changedPaths: ["owned.txt"] });
  assert.deepEqual(complete.info.includedPaths, ["owned.txt"]);
  assert.equal(complete.info.partial, false);
  assert.doesNotMatch(complete.body, /before\.txt|prior\.txt/);
  const unchanged = reviewSnapshot({ ...input, since: { id: "prior-review", snapshot: complete.info, allowUnchanged: true } });
  assert.deepEqual(unchanged.info.changedFiles, []);
  assert.deepEqual(unchanged.info.includedPaths, []);
  assert.match(unchanged.body, /No changed lines to resend/);
  assert.doesNotMatch(unchanged.body, /before\.txt|owned\.txt|secret\.env/);
  const withheld = reviewSnapshot({ ...input, changedPaths: ["secret.env"] });
  assert.equal(withheld.hasChanges, true);
  assert.equal(withheld.info.partial, true);
  assert.doesNotMatch(withheld.body, /secret\.env/);
});

test("a held reviewer keeps a checkpoint and spends no turn until explicitly continued", async () => {
  for (const available of [["codex"], ["codex", "claude"]]) {
    const calls = [];
    const packet = { hasChanges: true, info: { includedPaths: ["fixture.txt"] } };
    await runFlow({
      mode: "build-review", agents: ["codex", "claude"], available, stopped: () => false, policy: "normal",
      readReview: async () => packet, skipReview: assert.fail, turnsLeft: () => 0,
      checkpointReview: async (review, handoff, reviewer) => {
        assert.equal(review, packet);
        assert.equal(handoff.from, "codex");
        assert.equal(reviewer, "claude");
        calls.push("checkpoint");
      },
      runAgent: async (agent) => { calls.push(agent); return { status: "completed" }; },
      pauseReview: () => calls.push("paused"),
    });
    assert.deepEqual(calls, available.length === 1 ? ["codex", "checkpoint"] : ["codex", "checkpoint", "paused"]);
  }
});

test("Smart routes only a verified small text edit without a model review", async () => {
  const { smartTextPath, smartReviewCandidate } = await import("../desktop/team-handoff.mjs");
  assert.equal(smartTextPath("Fix the typo in notes/README.md."), "notes/README.md");
  assert.equal(smartTextPath("Update README.md and implement it in api.js"), null);
  assert.equal(smartTextPath("Update README.md and ask for a review"), null);
  assert.equal(smartTextPath("Update ../README.md"), null);
  const packet = { hasChanges: true, info: { includedPaths: ["README.md"] }, changedPaths: ["README.md"], diffChars: 310 };
  assert.equal(smartReviewCandidate("README.md", { ...packet, changedPaths: ["README.md", "api.js"] }), false);
  assert.equal(smartReviewCandidate("README.md", { ...packet, info: { ...packet.info, partial: true } }), false);
  const calls = [];
  await runFlow({
    mode: "build-review", agents: ["codex", "claude"], stopped: () => false, policy: "smart",
    readReview: async () => packet, smartSkip: (review) => smartReviewCandidate("README.md", review),
    runAgent: async (agent) => { calls.push(agent); return { status: "completed" }; },
    skipReview: (reason) => assert.match(reason, /Smart verified/u), checkpointReview: assert.fail,
  });
  assert.deepEqual(calls, ["codex"]);
});

test("team context defaults are compact and explicit choices remain separate per role", async () => {
  const { teamContextNotes, teamRunOptions, usableDecisions } = await import("../desktop/team-handoff.mjs");
  const notes = [{ id: "enabled", enabled: true }, { id: "selected" }];
  const normal = teamRunOptions("normal").context;
  const compact = teamRunOptions("economy").context;
  assert.equal(compact.history, false);
  assert.deepEqual(teamContextNotes(notes, [], "economy", compact, "write"), []);
  assert.deepEqual(teamContextNotes(notes, ["selected"], "normal", normal, "write"), notes);
  assert.deepEqual(teamContextNotes(notes, ["selected"], "normal", normal, "review"), notes.slice(1));
  assert.deepEqual(teamContextNotes(notes, [], "normal", { ...normal, reviewerNotes: ["enabled"] }, "review"), notes.slice(0, 1));
  assert.deepEqual(teamContextNotes(notes, ["selected"], "normal", { ...normal, writerNotes: [] }, "write"), []);
  const scope = { branch: "main", base: "new" };
  const decision = { text: "review separately", scope };
  const pinned = { text: "keep staged files", pinned: true, scope };
  assert.deepEqual(usableDecisions([decision, pinned, { text: "stale", scope: { ...scope, base: "old" } }], scope), [pinned, decision]);
});

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
