import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { groupLinkedCommands, linkedNextAction, linkedTimelineRows, mergeLinkedPage } from "../src/linked-timeline.mjs";

const require = createRequire(import.meta.url);
const { linkedEvidence, linkedReceipts, nativeResumeCommand } = require("../desktop/linked-sessions.cjs");
const { shareableDiffPath } = require("../desktop/review-snapshot.cjs");

test("a combined timeline interleaves both transcripts and evidence without duplicating run messages", () => {
  const pages = {
    codex: { messages: [{ id: "codex-1", at: 3000 }, { id: "codex-1", at: 3000 }] },
    claude: { messages: [{ id: "claude-1", at: 1000 }] },
  };
  const run = {
    id: "run", startedAt: new Date(2000).toISOString(), finishedAt: new Date(4000).toISOString(),
    agents: { codex: { status: "completed", messages: [{ text: "already in native history" }] } },
    linkedHandoff: { from: "claude", count: 1 },
    evidence: [{ id: "test", agent: "codex", kind: "command", at: new Date(3500).toISOString() }],
  };
  assert.deepEqual(linkedTimelineRows(pages, [run], "all").map(({ kind, agent }) => [kind, agent]), [
    ["message", "claude"], ["handoff", "codex"], ["message", "codex"], ["command", "codex"], ["result", "codex"],
  ]);
  assert.equal(linkedTimelineRows(pages, [run], "claude").length, 1);
});

test("timeline refresh preserves paged history and survives a partial provider failure", () => {
  const latest = { messages: [{ id: "b" }], cursor: "before-b" };
  const loaded = mergeLinkedPage(latest, { messages: [{ id: "b" }, { id: "a" }], cursor: null }, true);
  assert.deepEqual(loaded.messages.map(({ id }) => id), ["b", "a"]);
  const refreshed = mergeLinkedPage(loaded, { messages: [{ id: "c" }, { id: "b" }], cursor: "before-b" });
  assert.deepEqual(refreshed.messages.map(({ id }) => id), ["c", "b", "a"]);
  assert.equal(refreshed.cursor, null);
  assert.deepEqual(mergeLinkedPage(refreshed, { error: "unavailable" }).messages, refreshed.messages);
});

test("linked command groups preserve message order and provider boundaries", () => {
  const command = (key, runId, agent = "codex") => ({ key, runId, agent, kind: "command" });
  const reply = { key: "reply", kind: "message" };
  const grouped = groupLinkedCommands([command("a", "1"), command("b", "1"), command("c", "1", "claude"),
    reply, command("d", "2"), command("e", "3")]);
  assert.deepEqual(grouped.map((row) => row.commands?.map(({ key }) => key) ?? row.key), [["a", "b"], ["c"], "reply", ["d"], ["e"]]);
});

test("next actions preserve an explicit saved note and suggest a peer review only for observed edits", () => {
  const link = { lastMode: "codex", source: { provider: "codex" } };
  const run = { mode: "codex", finishedAt: "finished", agents: { codex: { status: "completed" } }, linkedGit: { changed: true } };
  assert.equal(linkedNextAction(link, [run]).mode, "claude");
  assert.deepEqual(linkedNextAction({ ...link, next: { mode: "codex", text: "check retries" } }, [run]),
    { mode: "codex", text: "check retries", saved: true });
});

test("receipts retain actual delivery status and attachment options stay scoped to run evidence", () => {
  const run = {
    id: "run", startedAt: "start", agents: { claude: { status: "failed" } },
    linkedHandoff: { files: ["src/app.js"], from: "codex", count: 1 },
    evidence: [{ id: "test", kind: "command", agent: "codex", subject: "npm test", exitCode: 1, status: "failed" },
      { id: "approval", kind: "approval", subject: "request" }],
  };
  assert.equal(linkedReceipts([run], "claude")[0].status, "failed");
  assert.deepEqual(linkedReceipts([run], "codex"), []);
  assert.deepEqual(linkedEvidence([run]).map(({ selectionId }) => selectionId), ["run:codex:test"]);
  for (const file of [".env", ".npmrc", "keys/server.pem", "src/.git/config", "../password.txt"]) assert.equal(shareableDiffPath(file), false);
  assert.equal(shareableDiffPath("src/app.js"), true);
  assert.equal(shareableDiffPath("docs/fixture.txt"), true);
});

test("the native Windows command preserves quoting, exact ID and working directory", () => {
  const command = nativeResumeCommand({ agent: "claude", id: "abc-123", cwd: "C:\\Team's Repo", exe: "C:\\Program Files\\claude.exe" });
  assert.equal(command, "Set-Location -LiteralPath 'C:\\Team''s Repo' -ErrorAction Stop\r\n& 'C:\\Program Files\\claude.exe' --resume 'abc-123'");
});
