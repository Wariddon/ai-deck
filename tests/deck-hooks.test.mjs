import assert from "node:assert/strict";
import { test } from "node:test";
import { executeDeckHook, validateDeckHooks } from "../desktop/deck-hooks.mjs";

test("saved hooks support only fixed Git commands and validated provider scopes", async () => {
  const hook = { action: "whitespace", phase: "after", agent: "claude", enabled: true };
  assert.deepEqual(validateDeckHooks([hook]), [hook]);
  assert.throws(() => validateDeckHooks([hook, hook]), /already configured/u);
  assert.throws(() => validateDeckHooks([{ ...hook, action: "powershell" }]), /valid hook/u);
  const result = await executeDeckHook("git", "C:/fixture", hook.action, async (exe, args, options) => {
    assert.equal(exe, "git");
    assert.deepEqual(args, ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=NUL",
      "diff", "--no-ext-diff", "--no-textconv", "--check", "HEAD", "--"]);
    assert.equal(options.cwd, "C:/fixture");
    return { code: 2, stdout: "fixture.txt:1: trailing whitespace.\n", stderr: "" };
  });
  assert.deepEqual(result, { label: "Git diff --check", code: 2, output: "fixture.txt:1: trailing whitespace." });
});
