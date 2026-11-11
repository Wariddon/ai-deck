const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { test } = require("node:test");
const { inspectManagedWorktree } = require("../desktop/managed-worktree.cjs");
const exec = promisify(execFile);
const git = async (cwd, args) => (await exec("git", ["-c", "core.hooksPath=NUL", "-c", "user.name=AI Deck QA",
  "-c", "user.email=qa@example.invalid", "-c", "commit.gpgSign=false", ...args], { cwd, windowsHide: true })).stdout;

test("managed checkout checks preserve dirty work and reject substituted repositories and external paths", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-managed-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const repo = path.join(temp, "repo"), root = path.join(temp, "managed"), cwd = path.join(root, "task");
  fs.mkdirSync(repo); fs.mkdirSync(root);
  await git(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "file.txt"), "initial\n");
  await git(repo, ["add", "."]); await git(repo, ["commit", "-qm", "initial"]);
  await git(repo, ["worktree", "add", "--detach", cwd, "HEAD"]);
  const before = await inspectManagedWorktree(git, { repo, cwd, root });
  assert.equal(before.dirty, false); assert.equal(before.conflicted, false);
  fs.writeFileSync(path.join(cwd, "file.txt"), "user edit\n");
  const state = await inspectManagedWorktree(git, { repo, cwd, root });
  assert.equal(state.dirty, true); assert.equal(state.head, before.head);
  assert.equal(fs.readFileSync(path.join(cwd, "file.txt"), "utf8"), "user edit\n");
  const impostor = path.join(root, "other"); fs.mkdirSync(impostor);
  await git(impostor, ["init", "-q"]); await git(impostor, ["commit", "--allow-empty", "-qm", "other"]);
  await assert.rejects(inspectManagedWorktree(git, { repo, cwd: impostor, root }), /different Git repository/);
  await assert.rejects(inspectManagedWorktree(git, { repo, cwd: repo, root }), /outside AI Deck/);
  const gitDir = (await git(cwd, ["rev-parse", "--absolute-git-dir"])).trim();
  fs.writeFileSync(path.join(gitDir, "MERGE_HEAD"), before.head + "\n");
  assert.equal((await inspectManagedWorktree(git, { repo, cwd, root })).operation, "merge");
});
