import assert from "node:assert/strict";
import test from "node:test";
import { NativeDraftLedger } from "../desktop/native-chat-delivery.mjs";

const key = "codex:original";
const prior = [{ id: "old", role: "user", text: "Do it" }];
const saved = [{ id: "new", role: "user", text: "Do it" }, ...prior];
const replied = [{ id: "reply", role: "assistant", text: "Done" }, ...saved];

test("delivery after reopening uses new native message IDs rather than matching an old phrase", () => {
  const ledger = new NativeDraftLedger(); ledger.edited(key);
  ledger.begin(key, "Do it", "request-1", prior);
  assert.equal(ledger.receipt(key, prior, "Do it"), undefined);
  assert.deepEqual(ledger.receipt(key, replied, "Do it"), {
    prompt: "Do it", requestId: "request-1", status: "replied", discardDraft: true,
  });
});

test("a newly typed identical follow-up is preserved when the earlier send finishes", () => {
  const ledger = new NativeDraftLedger(); ledger.edited(key);
  const sent = ledger.begin(key, "Do it", "request-1", prior);
  ledger.edited(key); ledger.edited(key);
  assert.equal(ledger.canClear(key, sent, "Do it"), false);
  assert.equal(ledger.receipt(key, replied, "Do it").discardDraft, false);
});

test("a saved user message clears only its matching draft before the reply arrives", () => {
  const ledger = new NativeDraftLedger(); ledger.edited(key);
  ledger.begin(key, "Do it", "request-1", prior);
  assert.equal(ledger.receipt(key, saved, "Do it").status, "saved");
  assert.equal(ledger.receipt(key, saved, "A different next task").discardDraft, false);
  assert.equal(ledger.receipt("claude:original", saved, "Do it"), undefined);
});

test("completion of an older request cannot discard a newer submission record", () => {
  const ledger = new NativeDraftLedger();
  const older = ledger.begin(key, "Do it", "old-request", prior);
  const newer = ledger.begin(key, "Do it", "new-request", prior);
  ledger.finish(key, older);
  assert.equal(ledger.receipt(key, saved, "Do it").requestId, "new-request");
  ledger.finish(key, newer);
  assert.equal(ledger.receipt(key, saved, "Do it"), undefined);
});

test("bounded draft tracking fails closed if an old draft version was evicted", () => {
  const ledger = new NativeDraftLedger(); ledger.edited(key);
  const sent = ledger.begin(key, "Do it", "request-1", prior);
  for (let n = 0; n < 80; n++) { ledger.edited(String(n)); ledger.begin(String(n), "Task", String(n), []); }
  assert.equal(ledger.versions.size, 64);
  assert.equal(ledger.pending.size, 16);
  assert.equal(ledger.canClear(key, sent, "Do it"), false);
});

test("a restored draft without an edit token cannot be cleared after its tracking entry is evicted", () => {
  const ledger = new NativeDraftLedger();
  const restored = ledger.begin(key, "Do it", "restored-request", prior);
  assert.equal(ledger.canClear(key, restored, "Do it"), true);
  ledger.edited(key);
  for (let n = 0; n < 80; n++) ledger.edited("another-chat-" + n);
  assert.equal(ledger.canClear(key, restored, "Do it"), false);
});
