const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const test = require("node:test");
const { writeDraft, clearDraft, restoreCheckpoints, writeRunningCheckpoint } = require("../desktop/checkpoints.cjs");
const { batchDeltas } = require("../desktop/stream-deltas.cjs");

function profileFixture(t) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "deck-checkpoints-"));
  const files = [];
  t.after(() => {
    for (const file of files) fs.rmSync(path.join(profile, file), { force: true });
    const drafts = path.join(profile, "draft-checkpoints");
    if (fs.existsSync(drafts)) fs.rmdirSync(drafts);
    fs.rmdirSync(profile);
  });
  return { profile, files };
}

test("per-task checkpoint survives a restart without resurrecting an accepted draft", (t) => {
  const { profile, files } = profileFixture(t);
  const id = randomUUID();
  files.push(path.join("draft-checkpoints", id + ".json"));
  const task = { id, runHistory: [], recoveryDraft: { id: "old", draft: { prompt: "old format" } } };
  const workspaces = { repo: { tasks: [task] } };
  writeDraft(profile, id, { id: "new", draft: { prompt: "current" } });
  restoreCheckpoints(profile, workspaces);
  assert.equal(task.recoveryDraft.draft.prompt, "current");
  task.recoveryDraft = { consumedId: "new", draft: { prompt: "" } };
  restoreCheckpoints(profile, workspaces);
  assert.equal(task.recoveryDraft.draft.prompt, "");
  writeDraft(profile, id, { id: "next", draft: { prompt: "next turn" } });
  restoreCheckpoints(profile, workspaces);
  assert.equal(task.recoveryDraft.draft.prompt, "next turn");
  clearDraft(profile, id);
});

test("only a newer checkpoint can replace an unfinished run", (t) => {
  const { profile, files } = profileFixture(t);
  files.push("running-checkpoint.json");
  const base = { id: "run", agents: { codex: { status: "running" } }, finishedAt: null };
  const task = { id: randomUUID(), runHistory: [{ ...base }] };
  const workspaces = { repo: { tasks: [task] } };
  writeRunningCheckpoint(profile, { ...base, evidence: [{ id: "check" }] });
  restoreCheckpoints(profile, workspaces);
  assert.equal(task.runHistory[0].evidence[0].id, "check");
  task.runHistory[0].timeline = [{ kind: "steer", text: "saved after checkpoint" }];
  restoreCheckpoints(profile, workspaces);
  assert.equal(task.runHistory[0].timeline[0].kind, "steer");
  task.runHistory[0] = { ...base, finishedAt: "now" };
  restoreCheckpoints(profile, workspaces);
  assert.equal(task.runHistory[0].finishedAt, "now");
});

test("stream batches preserve text and agent keys before emitting a final event", () => {
  const emitted = [];
  const batch = batchDeltas((agent, event) => emitted.push([agent, event.key, event.text]));
  const delta = (agent, key, text) => batch.append(agent, { type: "delta", key, text });
  delta("codex", "same", "ก่อน");
  delta("claude", "same", "peer");
  delta("codex", "same", "หลัง");
  assert.deepEqual(emitted, []);
  batch.flush();
  batch.flush();
  assert.deepEqual(emitted, [["codex", "same", "ก่อนหลัง"], ["claude", "same", "peer"]]);
});