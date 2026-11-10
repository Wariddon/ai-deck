const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const maxPatchBytes = 16 * 1024 ** 2;
const maxNewBytes = 32 * 1024 ** 2;
const maxPaths = 200;
const commitId = /^[a-f\d]{40}(?:[a-f\d]{24})?$/iu;
const fingerprint = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function projectHead(git, repo) {
  const [revision, branch] = await Promise.all([
    git(repo, ["rev-parse", "--verify", "HEAD^{commit}"]),
    git(repo, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => ""),
  ]);
  const commit = revision.trim();
  if (!commitId.test(commit)) throw new Error("The current project commit could not be verified.");
  return { commit, branch: branch.trim() };
}

function fileInside(root, relative, createParents) {
  const parts = relative.split("/");
  if (/[\\:\0]/u.test(relative) || parts.some((part) => !part || [".", "..", ".git"].includes(part.toLowerCase()) || /[. ]$/u.test(part))) {
    throw new Error("The copy contains a path that cannot be transferred safely.");
  }
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    if (createParents && !fs.lstatSync(directory, { throwIfNoEntry: false })) fs.mkdirSync(directory);
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("A file would cross a linked folder. Review its path in the source worktree.");
  }
  return path.join(directory, parts.at(-1));
}

async function newFiles(git, source) {
  const list = await git(source, ["ls-files", "--others", "--exclude-standard", "-z"], { limit: 26000 });
  const files = list.split("\0").filter(Boolean);
  if (list.length >= 26000 || files.length > maxPaths) throw new Error("Too many new files to verify in one copy.");
  return files;
}

async function writeTrackedPatch(git, source, base, file, paths = []) {
  await git(source, ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", "--no-renames",
    "--submodule=short", "--ignore-submodules=none", "--output=" + file, base, "--", ...paths], { timeout: 90000 });
  if (!fs.existsSync(file)) return Buffer.alloc(0);
  if (fs.statSync(file).size > maxPatchBytes) throw new Error("The patch is too large to verify in one copy.");
  return fs.readFileSync(file);
}

function readNewFile(source, file, remaining) {
  const from = fileInside(source, file, false);
  const info = fs.lstatSync(from);
  if (!info.isFile() || info.isSymbolicLink() || info.size > remaining) throw new Error("A new file is linked, unsupported, or too large to verify.");
  const data = fs.readFileSync(from);
  if (data.length > remaining) throw new Error("The new files are too large to verify.");
  return data;
}

async function transferPreview(git, { source, base, temp, includeDiff = true, includeFileDigests = false }) {
  if (!commitId.test(base)) throw new Error("The task's original base is invalid.");
  if (await git(source, ["ls-files", "--unmerged", "-z"], { limit: 2 })) throw new Error("Resolve the source worktree's existing conflicts first.");
  const scratch = fs.mkdtempSync(path.join(temp, "ai-deck-compare-"));
  const file = path.join(scratch, "compare.patch");
  try {
    const raw = await git(source, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=none",
      "--name-only", "-z", base, "--"], { limit: 26000 });
    const tracked = raw.split("\0").filter(Boolean);
    const files = await newFiles(git, source);
    if (raw.length >= 26000 || tracked.length + files.length > maxPaths) throw new Error("Too many paths to compare in one copy.");
    const patch = await writeTrackedPatch(git, source, base, file);
    const digests = [];
    let remaining = maxNewBytes;
    for (const name of files) {
      const data = readNewFile(source, name, remaining);
      remaining -= data.length;
      digests.push([name, fingerprint(data)]);
    }
    const stamp = fingerprint(JSON.stringify([tracked, fingerprint(patch), digests]));
    let fileDigests;
    if (includeFileDigests) {
      const boundaries = patch.length ? [0] : [];
      for (let index = patch.indexOf("\ndiff --git "); index >= 0; index = patch.indexOf("\ndiff --git ", index + 1)) boundaries.push(index + 1);
      if (boundaries.length !== tracked.length || patch.length && !patch.subarray(0, 11).equals(Buffer.from("diff --git "))) {
        throw new Error("The changed paths could not be matched to the Git patch.");
      }
      fileDigests = [...tracked.map((name, index) => [name, fingerprint(patch.subarray(boundaries[index], boundaries[index + 1]))]), ...digests];
    }
    return { tracked, files, stamp, fileDigests, ...(includeDiff && { diff: patch.toString("utf8", 0, 90000), truncated: patch.length > 90000 }) };
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmdirSync(scratch);
  }
}

async function copyOnBase(git, { source, destination, base, temp, paths, keepStaged = false }) {
  if (!commitId.test(base)) throw new Error("The task's original base is invalid.");
  if (await git(source, ["ls-files", "--unmerged", "-z"], { limit: 2 })) throw new Error("Resolve the source worktree's existing conflicts first.");
  const scratch = fs.mkdtempSync(path.join(temp, "ai-deck-base-"));
  const patch = path.join(scratch, "changes.patch");
  const comparison = path.join(scratch, "verification.patch");
  const trackedPatch = (file) => paths?.length === 0 ? Buffer.alloc(0) : writeTrackedPatch(git, source, base, file, paths);
  const selectedNew = async () => (await newFiles(git, source)).filter((file) => !paths || paths.includes(file));
  try {
    const original = await trackedPatch(patch);
    const files = await selectedNew();
    if (/^[-+]Subproject commit /mu.test(original.toString("utf8"))) throw new Error("Transfer the submodule changes separately before updating this base.");
    if (original.length) {
      try {
        await git(destination, ["-c", "core.hooksPath=NUL", "apply", "--3way", "--index", "--whitespace=nowarn", "--", patch], { timeout: 90000 });
      } catch (error) {
        throw new Error("The changes could not be replayed on this base. The source task is intact.\n" + error.message.slice(0, 1000));
      }
      if (!keepStaged) await git(destination, ["-c", "core.hooksPath=NUL", "reset", "--quiet", "--mixed", "HEAD"], { timeout: 90000 });
    }
    const copied = [];
    let bytes = 0;
    for (const file of files) {
      const data = readNewFile(source, file, maxNewBytes - bytes);
      bytes += data.length;
      const to = fileInside(destination, file, true);
      if (fs.lstatSync(to, { throwIfNoEntry: false })) throw new Error("A new file already exists on the target base: " + file);
      fs.writeFileSync(to, data, { flag: "wx" });
      copied.push({ file, size: data.length, hash: fingerprint(data) });
    }
    const current = await trackedPatch(comparison);
    if (!original.equals(current) || JSON.stringify(files) !== JSON.stringify(await selectedNew()) || copied.some(({ file, size, hash }) => {
      const from = fileInside(source, file, false);
      const info = fs.lstatSync(from);
      return !info.isFile() || info.isSymbolicLink() || info.size !== size || fingerprint(fs.readFileSync(from)) !== hash;
    })) throw new Error("The source changed during the copy. Retry after the editor finishes saving.");
    return { trackedChanges: original.length > 0, newFiles: files.length };
  } finally {
    fs.rmSync(patch, { force: true });
    fs.rmSync(comparison, { force: true });
    fs.rmdirSync(scratch);
  }
}

module.exports = { projectHead, copyOnBase, transferPreview };
