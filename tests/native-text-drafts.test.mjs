import { test } from "node:test";
import assert from "node:assert/strict";
import { NativeTextDrafts, nativeTextDraftsKey } from "../src/native-text-drafts.mjs";

function fixture(initial = []) {
  const timers = new Map(), saved = new Map([[nativeTextDraftsKey, JSON.stringify(initial)]]);
  let serial = 0, writes = 0, fail = false;
  const storage = { getItem: key => saved.get(key), setItem(key, value) { if (fail) throw Error("Quota exceeded"); saved.set(key, value); writes++; } };
  const options = { setTimer: fn => { timers.set(++serial, fn); return serial; }, clearTimer: id => timers.delete(id) };
  return { storage, options, timers, get writes() { return writes; }, fail: value => { fail = value; },
    tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); } };
}

test("unsent native drafts beyond sixteen chats survive batching and restart without provider collisions", () => {
  const f = fixture(), store = new NativeTextDrafts(f.storage, f.options);
  for (let i = 0; i < 40; i++) store.set(JSON.stringify([i % 2 ? "codex" : "claude", "", String(i)]), "Unsent " + i);
  assert.equal(store.drafts.size, 40);
  assert.equal(f.writes, 0);
  assert.equal(f.timers.size, 1);
  f.tick();
  assert.equal(f.writes, 1);
  const restored = new NativeTextDrafts(f.storage, f.options);
  assert.deepEqual(restored.drafts, store.drafts);
  const codex = JSON.stringify(["codex", "", "same-id"]), claude = JSON.stringify(["claude", "", "same-id"]);
  store.set(codex, "Codex draft"); store.set(claude, "Claude draft"); store.flush();
  assert.equal(store.drafts.get(codex), "Codex draft"); assert.equal(store.drafts.get(claude), "Claude draft");
});

test("typing coalesces writes and navigation flush or delivery clear persists immediately", () => {
  const f = fixture(), store = new NativeTextDrafts(f.storage, f.options);
  for (let i = 0; i < 60; i++) store.set("chat", "typing " + i);
  assert.equal(f.writes, 0);
  store.flush();
  assert.equal(f.writes, 1); assert.equal(f.timers.size, 0);
  assert.equal(new NativeTextDrafts(f.storage, f.options).drafts.get("chat"), "typing 59");
  store.set("chat", "typing 59"); store.flush(); assert.equal(f.writes, 1);
  store.delete("chat");
  assert.equal(f.writes, 2); assert.equal(new NativeTextDrafts(f.storage, f.options).drafts.size, 0);
});

test("a failed disk write retains all in-memory drafts, reports the failure and retries without losing the last saved data", () => {
  const f = fixture([["old", "Already saved"]]), store = new NativeTextDrafts(f.storage, f.options), notices = [];
  store.onError = error => notices.push(error);
  f.fail(true); store.set("new", "Still unsent"); f.tick();
  assert.equal(store.dirty, true); assert.equal(store.drafts.get("new"), "Still unsent");
  assert.match(notices.at(-1), /could not be saved/u);
  assert.equal(new NativeTextDrafts(f.storage, f.options).drafts.get("old"), "Already saved");
  f.fail(false); assert.equal(store.flush(), true); assert.equal(notices.at(-1), "");
  assert.deepEqual(new NativeTextDrafts(f.storage, f.options).drafts, store.drafts);
});

test("malformed saved rows do not erase other chats and empty legacy drafts are omitted", () => {
  const f = fixture([["a", "Keep"], null, {}, ["bad", 3], ["empty", ""], ["b", "Also keep"]]);
  assert.deepEqual([...new NativeTextDrafts(f.storage, f.options).drafts], [["a", "Keep"], ["b", "Also keep"]]);
});
