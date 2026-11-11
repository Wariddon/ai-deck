const fs = require("node:fs");
const path = require("node:path");

const physical = (value) => fs.realpathSync.native(path.resolve(value));
const same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

// Lifecycle observations are local Git evidence, not model-generated status.
async function inspectManagedWorktree(git, { repo, cwd, root }) {
  const folder = physical(cwd), managedRoot = physical(root);
  if (!same(path.dirname(folder), managedRoot)) throw new Error("The task worktree is outside AI Deck's managed folder.");
  const [owner, identity] = await Promise.all([
    git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    git(folder, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--absolute-git-dir", "HEAD"]),
  ]);
  const [top, common, gitDir, head] = identity.trim().split(/\r?\n/u);
  if (!top || !common || !gitDir || !/^[a-f\d]{40}(?:[a-f\d]{24})?$/iu.test(head ?? "") ||
      !same(physical(top), folder) || !same(physical(common), physical(owner.trim()))) {
    throw new Error("The recorded worktree belongs to a different Git repository. AI Deck kept its files unchanged.");
  }
  const status = await git(folder, ["--no-optional-locks", "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=no"], { limit: 26000 });
  const rows = status.split("\0");
  const operation = [["rebase-merge", "rebase"], ["rebase-apply", "rebase"], ["MERGE_HEAD", "merge"],
    ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"], ["BISECT_LOG", "bisect"]]
    .find(([file]) => fs.existsSync(path.join(gitDir, file)))?.[1];
  return { cwd: folder, head, branch: rows.find((row) => row.startsWith("# branch.head "))?.slice(14),
    dirty: rows.some((row) => /^[12u] /u.test(row)), conflicted: rows.some((row) => row.startsWith("u ")),
    ...(status.length >= 26000 && { partial: true }),
    ...(operation && { operation }), checkedAt: new Date().toISOString() };
}

module.exports = { inspectManagedWorktree };
