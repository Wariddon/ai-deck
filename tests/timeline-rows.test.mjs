import assert from "node:assert/strict";
import { test } from "node:test";
import { appendLiveRow, conversationTurns, retainTimelineRows } from "../src/timeline-rows.mjs";

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
