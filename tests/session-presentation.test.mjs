import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestedSessionTitle } from "../desktop/session-title.cjs";
import { claudeArguments } from "../desktop/engines.cjs";
import { sessionActivity } from "../src/session-activity.mjs";
import { RunPool } from "../desktop/run-pool.cjs";

test("new session titles use the user's first line without wrapper text or broken Unicode", () => {
  assert.equal(suggestedSessionTitle("Current user task: Task from the user: ช่วยแก้หน้าแชท\nSystem instructions"), "ช่วยแก้หน้าแชท");
  assert.equal(suggestedSessionTitle("\n  สรุป   งานวันนี้  \nquoted history"), "สรุป งานวันนี้");
  assert.equal(suggestedSessionTitle(""), "New task");
  assert.equal(suggestedSessionTitle("😀😀😀", 2), "😀😀");
  const fresh = claudeArguments([], null, { sessionName: "Task from the user: งานใหม่", persistSession: true });
  assert.equal(fresh[fresh.indexOf("--name") + 1], "งานใหม่");
  assert.ok(!claudeArguments([], "existing-chat", { sessionName: "Overwrite", persistSession: true }).includes("--name"));
  assert.ok(!claudeArguments([], null, { sessionName: "Transient", persistSession: false }).includes("--name"));
});

test("loading rings follow exact native IDs and active team members, with distinct wait and approval states", () => {
  const jobs = [{ key: "task:team-1", taskId: "team-1", repo: "repo-a", state: "running", nativeSessions: [{ provider: "claude", id: "original-claude" }] }];
  assert.equal(sessionActivity({ id: "team-1", repo: "repo-a" }, jobs).state, "working");
  assert.equal(sessionActivity({ provider: "claude", id: "original-claude" }, jobs).state, "working");
  assert.equal(sessionActivity({ provider: "codex", id: "original-claude" }, jobs), null);
  assert.equal(sessionActivity({ id: "team-1", repo: "repo-b" }, jobs), null);
  assert.equal(sessionActivity({ provider: "claude", id: "idle-chat" }, jobs), null);
  const native = { provider: "codex", id: "direct" };
  assert.equal(sessionActivity(native, [{ key: "native:codex:direct", state: "waiting", reason: "Low RAM" }]).label, "Low RAM");
  assert.equal(sessionActivity(native, [{ key: "native:codex:direct", state: "running", needsInput: true }]).state, "input");
  assert.equal(sessionActivity(native, []), null);
});

test("run-pool snapshots publish only current native session references and clear them at completion", async () => {
  const pool = new RunPool(); let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const task = { id: "t", title: "Task" }, job = { activeNativeSessions: { member: { provider: "codex", id: "c" } } };
  const running = pool.submit({ key: "task:t", task, job }, async () => { await waiting; pool.release(); });
  assert.deepEqual(pool.snapshot()[0].nativeSessions, [{ provider: "codex", id: "c" }]);
  delete job.activeNativeSessions.member;
  assert.deepEqual(pool.snapshot()[0].nativeSessions, []);
  release(); await running;
  assert.deepEqual(pool.snapshot(), []);
});
