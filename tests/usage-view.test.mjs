import test from "node:test";
import assert from "node:assert/strict";
import { latestReportedRun } from "../src/usage-view.mjs";

test("a skipped Claude does not create usage and can point back to the latest real provider report", () => {
  const old = { id: "old", agents: { claude: { status: "completed", usage: { total: 400 } } } };
  const actual = { id: "actual", agents: { reviewer: { provider: "claude", status: "completed", usage: { total: 200 } } } };
  const skipped = { id: "skipped", agents: { codex: { status: "interrupted", usage: { total: 900 } }, claude: { status: "skipped" } } };
  assert.equal(latestReportedRun([old, actual, skipped], "claude"), actual);
  assert.equal(latestReportedRun([old, actual, skipped], "codex"), skipped);
  assert.equal(latestReportedRun([skipped], "claude"), undefined);
  assert.equal(latestReportedRun([{ agents: { claude: { usage: { total: NaN } } } }], "claude"), undefined);
});
