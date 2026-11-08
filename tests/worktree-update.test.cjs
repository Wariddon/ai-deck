const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { test } = require("node:test");
const { copyOnBase, projectHead } = require("../desktop/worktree-update.cjs");

const exec = promisify(execFile);
const git = async (cwd, args) => (await exec("git", ["-c", "core.hooksPath=NUL", "-c", "user.name=AI Deck Test",
  "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false", ...args], { cwd, windowsHide: true })).stdout;

test("replays tracked and new files on an updated base and leaves source staging alone", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-update-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const repo = path.join(root, "repo");
  const source = path.join(root, "source");
  const target = path.join(root, "candidate");
  const conflict = path.join(root, "conflict");
  fs.mkdirSync(repo);
  await git(repo, ["init", "-q"]);
  fs.writeFileSync(path.join(repo, "shared.txt"), "base\n");
  fs.writeFileSync(path.join(repo, ".gitignore"), "local-only.txt\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-qm", "Original"]);
  const { commit: base } = await projectHead(git, repo);
  await git(repo, ["worktree", "add", "--detach", source, base]);
  fs.writeFileSync(path.join(source, "shared.txt"), "source edit\n");
  await git(source, ["add", "shared.txt"]);
  fs.writeFileSync(path.join(source, "draft.txt"), "new file\n");
  fs.writeFileSync(path.join(source, "local-only.txt"), "ignored file\n");
  fs.writeFileSync(path.join(repo, "upstream.txt"), "added upstream\n");
  await git(repo, ["add", "upstream.txt"]);
  await git(repo, ["commit", "-qm", "Nonconflicting update"]);
  await git(repo, ["worktree", "add", "--detach", target, "HEAD"]);
  assert.deepEqual(await copyOnBase(git, { source, destination: target, base, temp: root }), { trackedChanges: true, newFiles: 1 });
  assert.equal(fs.readFileSync(path.join(target, "shared.txt"), "utf8").replaceAll("\r\n", "\n"), "source edit\n");
  assert.equal(fs.readFileSync(path.join(target, "draft.txt"), "utf8"), "new file\n");
  assert.equal(fs.existsSync(path.join(target, "local-only.txt")), false);
  assert.match(await git(source, ["diff", "--cached", "--", "shared.txt"]), /source edit/);
  assert.equal(await git(target, ["diff", "--cached"]), "");
  fs.writeFileSync(path.join(repo, "shared.txt"), "upstream conflicting edit\n");
  await git(repo, ["add", "shared.txt"]);
  await git(repo, ["commit", "-qm", "Conflicting update"]);
  await git(repo, ["worktree", "add", "--detach", conflict, "HEAD"]);
  await assert.rejects(copyOnBase(git, { source, destination: conflict, base, temp: root }), /could not be replayed/);
  assert.equal(fs.readFileSync(path.join(source, "shared.txt"), "utf8"), "source edit\n");
  assert.equal(fs.readFileSync(path.join(source, "draft.txt"), "utf8"), "new file\n");
});
