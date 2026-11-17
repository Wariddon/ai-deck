import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeNativeLatest, mergeNativeOlder, nativeHistoryCursor } from "../desktop/native-history.mjs";
const row = (id, text = id) => ({ id, role: "assistant", text });

test("an unchanged latest page reuses loaded messages and keeps the oldest cursor", () => {
  const current = { messages: [row("3"), row("2"), row("1")], cursor: "oldest", hasOlder: true, historyExtended: true,
    delivered: { status: "saved" }, outcome: { error: "old error" } };
  const next = mergeNativeLatest(current, { messages: [row("3"), row("2")], cursor: "latest", hasOlder: true, chat: { revision: "new" } });
  assert.equal(next.messages, current.messages);
  assert.equal(next.cursor, "oldest"); assert.equal(next.chat.revision, "new");
  assert.equal(next.delivered, undefined); assert.equal(next.outcome, undefined);
});

test("a new reply updates matching messages once and preserves loaded history and its end", () => {
  const current = { messages: [row("3", "partial"), row("2"), row("1")], cursor: null, hasOlder: false, historyExtended: true };
  const next = mergeNativeLatest(current, { messages: [row("4"), row("3", "complete")], cursor: "latest", hasOlder: true });
  assert.deepEqual(next.messages.map(({ id, text }) => [id, text]), [["4", "4"], ["3", "complete"], ["2", "2"], ["1", "1"]]);
  assert.equal(next.cursor, null); assert.equal(next.hasOlder, false);
  assert.equal(current.messages[0].text, "partial");
});

test("a complete readable snapshot replaces removed history rather than retaining stale rows", () => {
  const next = mergeNativeLatest({ messages: [row("2"), row("1")], cursor: "older", historyExtended: true },
    { messages: [row("2")], hasOlder: false, cursor: null });
  assert.deepEqual(next.messages, [row("2")]); assert.equal(next.historyExtended, false);
});

test("duplicate older pages advance the cursor without rebuilding the loaded message list", () => {
  const current = { messages: [row("3"), row("2")], cursor: "middle", hasOlder: true };
  const duplicate = mergeNativeOlder(current, { messages: [row("2", "stale")], cursor: "older", hasOlder: true });
  assert.equal(duplicate.messages, current.messages); assert.equal(duplicate.cursor, "older");
  const added = mergeNativeOlder(duplicate, { messages: [row("1")], cursor: null, hasOlder: false });
  assert.deepEqual(added.messages.map(({ id }) => id), ["3", "2", "1"]); assert.equal(added.historyExtended, true);
});

test("native history cursors are provider-specific and bounded", () => {
  assert.equal(nativeHistoryCursor("codex", "saved-cursor"), "saved-cursor");
  assert.deepEqual(nativeHistoryCursor("claude", { end: 0, discard: true, other: "ignored" }), { end: 0, discard: true });
  for (const value of [undefined, "", "x".repeat(2049), {}, { end: -1 }, { end: 2, discard: "yes" }])
    assert.throws(() => nativeHistoryCursor("codex", value));
  for (const value of [undefined, "saved-cursor", [], { end: -1 }, { end: 2, discard: "yes" }])
    assert.throws(() => nativeHistoryCursor("claude", value));
  assert.equal(nativeHistoryCursor("claude", null), null);
});
