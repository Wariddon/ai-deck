import assert from "node:assert/strict";
import { test } from "node:test";
import { appendLiveDeltas, appendLiveRow, applyRunUpdate, conversationTurns, frameDeltas, retainTimelineRows } from "../src/timeline-rows.mjs";
import { createTimelineProjector } from "../src/timeline-projection.mjs";

test("streaming reuses projected history and finishing a resumed review replaces the original result", () => {
  const project = createTimelineProjector();
  const earlier = { id: "earlier", finishedAt: "2026-11-10", agents: {}, collaboration: { handoffs: [] } };
  const active = { id: "active", agents: {}, collaboration: { handoffs: [], resumedFrom: earlier.id } };
  const oldPrompt = { id: "earlier:prompt", kind: "prompt" };
  const oldReply = { id: "earlier:reply", kind: "message" };
  const prompt = { id: "active:prompt", kind: "prompt" };
  const reply = { id: "active:reply", kind: "message", text: "Streaming" };
  const rows = [oldPrompt, oldReply, prompt, reply];
  const first = project(rows, [earlier, active], false);
  const next = project([...rows.slice(0, -1), { ...reply, text: "Streaming text" }], [earlier, active], false);
  assert.equal(first[1].id, "earlier:team-result");
  assert.equal(next[1], first[1]);
  assert.equal(next.at(-1).text, "Streaming text");
  assert.equal(project(rows, [earlier, active], true)[1], oldReply);
  const finished = project(rows, [{ ...earlier, followupReview: active.id }, { ...active, finishedAt: earlier.finishedAt }], false);
  assert.deepEqual(finished.map(({ id }) => id), ["earlier:prompt", "active:team-result"]);
});

test("Auto Team shows the recorded decision in both layouts and hides retries and streaming JSON", () => {
  const project = createTimelineProjector();
  const run = { id: "team", mode: "auto-team", autoTeam: { planner: "codex" }, agents: {} };
  const prompt = { id: "team:prompt", kind: "prompt" };
  const proposal = { id: "team:proposal", kind: "message", agent: "codex", text: "Suggested assignment" };
  const retry = { id: "team:retry", kind: "message", agent: "claude", text: "```text\nAI_DECK_AUTO: SPLIT\n{invalid}\n```" };
  const decision = { id: "team:decision", kind: "message", agent: "claude", text: 'AI_DECK_AUTO: CODEX\n{"summary":' };
  const rows = [prompt, proposal, retry, decision];
  assert.deepEqual(project(rows, [run], false).map(({ id }) => id), [prompt.id, proposal.id, decision.id]);
  assert.equal(project(rows, [run], false).at(-1).text, "Checking the team plan…");

  const teamPlan = { state: "ready", from: "claude", text: "Codex will implement the change.",
    assignments: { codex: { task: "Implement", paths: ["src/a.js"], acceptance: ["Tests pass"] } } };
  const completed = { ...run, finishedAt: "2026-11-10", teamPlan };
  for (const split of [false, true]) {
    const visible = project(rows, [completed], split);
    assert.equal(visible[1], proposal);
    assert.deepEqual(visible.at(-1), { ...decision, text: teamPlan.text, planDecision: teamPlan });
  }
  assert.match(decision.text, /AI_DECK_AUTO/u);
});

test("Auto Team displays the verified hold instead of the writer assignment proposed by the model", () => {
  const project = createTimelineProjector();
  const reply = { id: "team:decision", kind: "message", agent: "codex", text: 'AI_DECK_AUTO: CLAUDE\n{"summary":"Use origin/main"}' };
  const plan = { state: "needs-input", from: "codex", requiredBase: "origin/main", text: "The checked base differs from origin/main." };
  const run = { id: "team", autoTeam: { planner: "claude" }, finishedAt: "2026-11-10", teamPlan: plan };
  assert.deepEqual(project([reply], [run], false), [{ ...reply, text: plan.text, planDecision: plan }]);
  assert.equal(project([reply], [{ ...run, autoTeam: undefined }], false)[0], reply);
  assert.equal(project([reply], [{ ...run, autoTeam: { ...run.autoTeam, planId: "approved" } }], false)[0], reply);
});

test("active run updates retain earlier runs and reject messages for a different task or finished turn", () => {
  const earlier = { id: "old", finishedAt: "2026-11-10" };
  const active = { id: "live" };
  const workspace = { taskId: "current", runHistory: [earlier, active], queue: [{ id: "queued" }] };
  const run = { ...active, collaboration: { handoffs: [{ sent: true }] } };
  const next = applyRunUpdate(workspace, { taskId: "current", run, codexThread: "thread" });
  assert.equal(next.runHistory[0], earlier);
  assert.equal(next.runHistory[1], run);
  assert.equal(next.codexThread, "thread");
  assert.equal(next.queue, workspace.queue);
  assert.equal(applyRunUpdate(next, { taskId: "elsewhere", run }), next);
  assert.equal(applyRunUpdate(next, { taskId: "current", run: earlier }), next);
  const finished = { ...next, runHistory: [earlier, { ...run, finishedAt: "2026-11-10" }] };
  assert.equal(applyRunUpdate(finished, { taskId: "current", run }), finished);
});

test("streaming fragments from both agents publish together before a final message", () => {
  const callbacks = new Map();
  let frame = 0;
  const published = [];
  const deltas = frameDeltas((rows) => published.push(rows), (callback) => {
    callbacks.set(++frame, callback);
    return frame;
  }, (id) => callbacks.delete(id));
  for (let index = 0; index < 120; index++) deltas.append({ id: index % 2 ? "run:claude" : "run:codex", text: "x" });
  assert.equal(callbacks.size, 1);
  deltas.flush();
  assert.equal(callbacks.size, 0);
  assert.deepEqual(published.map((batch) => batch.map(({ id, text }) => [id, text.length])), [[["run:codex", 60], ["run:claude", 60]]]);
  deltas.append({ id: "run:claude", text: "new" });
  deltas.discard();
  assert.equal(callbacks.size, 0);
  assert.equal(published.length, 1);
});

test("batching two streams preserves order, history and each reply's model profile", () => {
  const previous = { id: "older:reply", kind: "message", text: "Earlier result" };
  const codex = { id: "active:codex", kind: "message", text: "Codex", profile: { model: "codex" } };
  const claude = { id: "active:claude", kind: "message", text: "Claude" };
  const rows = [previous, codex];
  const updated = appendLiveDeltas(rows, [claude, { id: codex.id, kind: "message", text: " reply" }]);
  assert.equal(updated[0], previous);
  assert.deepEqual(updated.slice(1), [{ ...codex, text: "Codex reply" }, claude]);
  assert.deepEqual(rows, [previous, codex]);
});

test("a long active turn keeps earlier answers, the current prompt, and approvals", () => {
  const previous = { id: "old:prompt", kind: "prompt" };
  const prompt = { id: "active:prompt", kind: "prompt" };
  const approval = { id: "active:approval", kind: "approval" };
  const reply = { id: "active:reply", kind: "message", text: "Hello" };
  let rows = [previous, prompt, approval, reply];
  for (let index = 0; index < 365; index++) {
    rows = appendLiveRow(rows, { id: "active:step:" + index, kind: "activity", text: "command output" });
  }
  assert.deepEqual(rows.slice(0, 3), [previous, prompt, approval]);
  assert.equal(rows.length, 324);
  assert.equal(rows[4].id, "active:step:45");
  rows = appendLiveRow(rows, { ...reply, text: " world" }, true);
  assert.equal(rows[3].text, "Hello world");
  const retained = retainTimelineRows([{ id: "removed:prompt", kind: "prompt" }, ...rows], [{ id: "old" }, { id: "active" }]);
  assert.deepEqual(retained.slice(0, 3), [previous, prompt, approval]);
  assert.equal(retained.filter(({ kind }) => kind === "activity").length, 60);
  assert.equal(retained[3].text, "Hello world");
});

test("chat turns put work behind one disclosure and leave approvals and replies in order", () => {
  const prompt = { id: "first:prompt", kind: "prompt" };
  const command = { id: "first:command", kind: "activity" };
  const approval = { id: "first:approval", kind: "approval" };
  const reply = { id: "first:reply", kind: "message" };
  const result = { id: "first:team-result", kind: "team-result", work: [{ id: "first:more-work", kind: "activity" }] };
  const notice = { id: "second:limit", kind: "system" };
  const runs = [{ id: "first" }, { id: "second" }];
  assert.deepEqual(conversationTurns([prompt, command, approval, reply, result, notice], runs), [
    { id: "first", run: runs[0], prompt, rows: [approval, reply, result], work: [command, ...result.work] },
    { id: "second", run: runs[1], rows: [notice], work: [] },
  ]);
});
