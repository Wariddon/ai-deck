import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { linkedUsageRecovery } from "../desktop/usage-routing.mjs";
import { linkedRecoveryDraft } from "../src/linked-timeline.mjs";

const require = createRequire(import.meta.url);
const { composeLinkedPatch, splitFilePatch } = require("../desktop/linked-transfer.cjs");
const { retainRuns } = require("../desktop/run-history.cjs");

test("a linked recovery keeps the current task and carries recorded outcomes to an available provider", () => {
  const failed = {
    id: "run-1", mode: "codex", finishedAt: "finished", prompt: "Update the retry behavior.",
    agents: { codex: { status: "limited" } }, linkedGit: { files: ["retry.js"] },
    evidence: [{ kind: "command", subject: "npm test", status: "completed", exitCode: 0 }],
  };
  const workspace = { linkedSession: {}, runHistory: [failed] };
  const connections = { codex: { status: "ready" }, claude: { status: "ready" } };
  const recovery = linkedUsageRecovery(workspace, "codex", connections);
  assert.equal(recovery.mode, "claude-write");
  assert.match(linkedRecoveryDraft(recovery), /retry\.js/);
  assert.match(linkedRecoveryDraft(recovery), /npm test · completed · exit 0/);
  assert.equal(linkedUsageRecovery({ ...workspace, readOnly: true }, "codex", connections).mode, "claude");
  assert.equal(linkedUsageRecovery(workspace, "codex", { ...connections, claude: { status: "signIn" } }).available, false);
  assert.equal(linkedUsageRecovery(workspace, "claude", connections), null);
});

test("steps keep their pinned run evidence beyond the ordinary retention window", () => {
  const runs = Array.from({ length: 24 }, (_, index) => ({ id: String(index), agents: {} }));
  const kept = retainRuns(runs, { id: "24", agents: {} }, ["0"]);
  assert.equal(kept.length, 25);
  assert.equal(kept[0].id, "0");
  assert.equal(retainRuns(runs, { id: "24", agents: {} })[0].id, "1");
});

test("a reviewed partial Git patch includes only the chosen hunks in original order", () => {
  const header = "diff --git a/test.txt b/test.txt\n--- a/test.txt\n+++ b/test.txt\n";
  const hunk1 = "@@ -2 +2 @@\n-first\n+edited first\n";
  const hunk2 = "@@ -20 +20 @@\n-second\n+edited second\n";
  const patch = splitFilePatch("test.txt", header + hunk1 + hunk2);
  assert.equal(patch.wholeOnly, false);
  const patches = new Map([["test.txt", patch]]);
  assert.equal(composeLinkedPatch(patches, [{ file: "test.txt", hunks: [1] }]), header + hunk2);
  assert.equal(composeLinkedPatch(patches, [{ file: "test.txt", hunks: [1, 0] }]), header + hunk1 + hunk2);
  assert.throws(() => composeLinkedPatch(patches, [{ file: "test.txt", hunks: [2] }]), /valid hunks/);
  assert.throws(() => composeLinkedPatch(patches, [{ file: "other.txt", hunks: null }]), /current diff/);
});

test("new files require whole-file review and binary or linked patches are excluded", () => {
  const header = "diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n";
  const text = header + "@@ -0,0 +1 @@\n+added\n";
  const patch = splitFilePatch("new.txt", text);
  assert.equal(patch.wholeOnly, true);
  assert.equal(composeLinkedPatch(new Map([["new.txt", patch]]), [{ file: "new.txt", hunks: null }]), text);
  assert.throws(() => composeLinkedPatch(new Map([["new.txt", patch]]), [{ file: "new.txt", hunks: [0] }]), /whole file/);
  assert.throws(() => splitFilePatch("binary", "diff --git a/binary b/binary\nBinary files a/binary and b/binary differ\n"), /supported text patch/);
  assert.throws(() => splitFilePatch("symlink", "diff --git a/symlink b/symlink\nnew file mode 120000\n"), /supported text patch/);
});
