import assert from "node:assert/strict";
import test from "node:test";
import { replanContext, replanLinks } from "../desktop/replan-links.mjs";

const sourceRepo = "C:/Knowledge";
const source = () => ({ id: "source", title: "Original work", nativeHandoff: { source: { provider: "codex", id: "native-1" } },
  runHistory: [{ id: "plan-1", finishedAt: "2026-11-10", images: [{ id: "image-1" }], teamPlan: {
    state: "blocked", text: "The code for the requested change is in another project. Verify the files in the correct checkout before assigning a writer.",
  } }] });
const legacy = (task) => ({ id: "continued", title: "Continued work", forkedFrom: task.title,
  forkContext: replanContext(task.runHistory[0].teamPlan), nativeHandoff: structuredClone(task.nativeHandoff),
  runHistory: [{ images: [{ id: "image-1" }], prompt: "User clarified the original request before starting" }] });
const workspaces = (task) => ({ destination: { repo: "C:/App", tasks: [task] } });

test("explicit replan IDs preserve the relationship after chat renaming", () => {
  const task = { id: "next", title: "Renamed", replanSource: { repo: "c:\\KNOWLEDGE", taskId: "source", runId: "plan-1" } };
  assert.deepEqual(replanLinks(workspaces(task), sourceRepo, source()), [
    { repo: "C:/App", taskId: "next", title: "Renamed", sourceRunId: "plan-1" },
  ]);
  task.replanSource.taskId = "another";
  assert.deepEqual(replanLinks(workspaces(task), sourceRepo, source()), []);
});

test("legacy replan uses exact plan, native source and attachment matches despite a clarified prompt", () => {
  const original = source(), next = legacy(original);
  assert.equal(replanLinks(workspaces(next), sourceRepo, original)[0].taskId, "continued");
  next.forkContext = "The earlier plan was blocked in another project. Verify paths and claims against the new checkout.\n\n" + original.runHistory[0].teamPlan.text;
  original.runHistory.push({ id: "later-plan", finishedAt: "2026-11-11", teamPlan: { state: "blocked", text: "A later plan is separate." } });
  assert.equal(replanLinks(workspaces(next), sourceRepo, original)[0].sourceRunId, "plan-1");
  assert.equal(original.runHistory.at(-1).teamPlan.state, "blocked");
});

test("a same-title chat with a different source or different attachments is not inferred", () => {
  const original = source();
  for (const mutate of [
    (task) => { task.nativeHandoff.source.id = "another-native"; },
    (task) => { task.nativeHandoff.source.provider = "claude"; },
    (task) => { task.runHistory[0].images = []; },
    (task) => { task.forkContext += " changed"; },
  ]) {
    const next = legacy(original); mutate(next);
    assert.deepEqual(replanLinks(workspaces(next), sourceRepo, original), []);
  }
});

test("ambiguous legacy plans and archived destinations do not offer a misleading jump", () => {
  const original = source(), next = legacy(original);
  original.runHistory.push({ ...original.runHistory[0], id: "duplicate-plan" });
  assert.deepEqual(replanLinks(workspaces(next), sourceRepo, original), []);
  const archived = { ...legacy(source()), archivedAt: "2026-11-11" };
  assert.deepEqual(replanLinks(workspaces(archived), sourceRepo, source()), []);
});

test("exact links support multiple destinations without selecting one silently", () => {
  const next = { id: "one", title: "First", replanSource: { repo: sourceRepo, taskId: "source", runId: "plan-1" } };
  const all = workspaces(next); all.other = { repo: "C:/Other", tasks: [{ ...next, id: "two", title: "Second" }] };
  assert.deepEqual(replanLinks(all, sourceRepo, source()).map((link) => link.taskId), ["one", "two"]);
  assert.deepEqual(replanLinks({}, sourceRepo, source()), []);
});

test("incomplete legacy attachment records do not crash the workspace or infer a link", () => {
  for (const images of [null, {}, [null], [{}]]) {
    const original = source(), next = legacy(original);
    original.runHistory[0].images = images;
    next.runHistory[0].images = images;
    const all = workspaces(next); all.incomplete = null;
    assert.deepEqual(replanLinks(all, sourceRepo, original), []);
  }
});
