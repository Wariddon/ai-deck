const { test } = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const { retainProviderPaths } = require("../desktop/provider-paths.cjs");

test("verified provider paths survive missing packaged defaults independently of sign-in", () => {
  const previous = { git: path.resolve("git.exe") };
  for (const status of ["ready", "signIn", "upgrade"]) {
    const checked = { claude: { status, path: path.resolve("tools/claude.exe") } };
    const retained = retainProviderPaths(previous, checked);
    assert.equal(retained.claude, checked.claude.path);
    assert.equal(retained.git, previous.git);
    assert.equal(previous.claude, undefined);
    assert.equal(retainProviderPaths(retained, checked), retained, "Unchanged probes do not rewrite the profile");
  }
});

test("failed discovery and wrong executables do not replace the user's saved CLI", () => {
  const saved = { claude: path.resolve("selected/claude.exe") };
  for (const status of ["missing", "unavailable", "wrongExecutable"]) {
    assert.equal(retainProviderPaths(saved, { claude: { status, path: path.resolve("other.exe") } }), saved);
  }
  assert.equal(retainProviderPaths(saved, { claude: { status: "ready", path: "claude --print" } }), saved);
  assert.equal(retainProviderPaths(saved, { other: { status: "ready", path: path.resolve("other.exe") } }), saved);
});
