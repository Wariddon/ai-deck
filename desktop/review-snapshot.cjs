const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const sourceExtensions = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".html", ".java", ".js", ".jsx",
  ".kt", ".md", ".mjs", ".cjs", ".php", ".ps1", ".py", ".rb", ".rs", ".scss", ".sh", ".sql",
  ".svelte", ".swift", ".ts", ".tsx", ".vue",
]);
const sensitivePath = /(?:^|[\/_.-])(?:env|credentials?|secrets?|passwords?|tokens?|private[-_]keys?)(?:$|[\/_.-])/iu;
const decoder = new TextDecoder("utf-8", { fatal: true });

function eligibleReviewPath(relative) {
  if (typeof relative !== "string" || !relative || relative.length > 1024 || /[\\:\0]/u.test(relative)) return false;
  if (relative.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) return false;
  const name = path.basename(relative);
  return !sensitivePath.test(relative) && (sourceExtensions.has(path.extname(name).toLowerCase()) || ["Dockerfile", "Makefile"].includes(name));
}

function readNewSource(root, relative, maximum) {
  if (!eligibleReviewPath(relative)) return null;
  try {
    const resolved = path.resolve(root, relative);
    const real = fs.realpathSync(resolved);
    const location = path.relative(root, real);
    if (location === ".." || location.startsWith(".." + path.sep) || path.isAbsolute(location) || !fs.lstatSync(resolved).isFile()) return null;
    const fd = fs.openSync(real, "r");
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > maximum) return null;
      const buffer = Buffer.alloc(maximum + 1);
      const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (size !== stat.size || buffer.subarray(0, size).includes(0)) return null;
      return decoder.decode(buffer.subarray(0, size));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

const digest = (value) => createHash("sha256").update(value).digest("hex");

function patchEntries(diff, names) {
  if (typeof names !== "string" || names.length >= 26000 || diff.length >= 90000) return null;
  const paths = names.split("\0").filter(Boolean);
  const sections = diff ? diff.split(/(?=^diff --git )/mu) : [];
  if (paths.length !== sections.length || sections.some((section) => !section.startsWith("diff --git "))) return null;
  return paths.map((file, index) => ({ file, patch: sections[index] }));
}

function changedReviewPaths(before, after) {
  if (!before || !after) return null;
  const previous = new Map(before);
  const current = new Map(after);
  return [...new Set([...previous.keys(), ...current.keys()])].filter((file) => previous.get(file) !== current.get(file));
}

function reviewSnapshot({ cwd, head, base, diff, status, tracked, untracked, phase, includeNew, selectedFiles, target,
  names, since, untrackedTruncated = false }) {
  const maxDiff = 32000;
  const maxNew = 12000;
  const fileNames = untracked.split("\0").filter(Boolean);
  const added = [];
  let newBytes = 0;
  const candidates = Array.isArray(selectedFiles) ? selectedFiles.filter((file) => fileNames.includes(file)) : includeNew ? fileNames : [];
  if (candidates.length) {
    const root = fs.realpathSync(cwd);
    for (const file of candidates) {
      if (added.length >= 6 || newBytes >= maxNew) break;
      const text = readNewSource(root, file, Math.min(8000, maxNew - newBytes));
      if (text === null) continue;
      newBytes += Buffer.byteLength(text);
      added.push({ file, text });
    }
  }
  const addedFiles = added.map(({ file }) => file);
  const omittedFiles = fileNames.filter((file) => !addedFiles.includes(file));
  const unavailableSelected = (selectedFiles ?? []).filter((file) => !fileNames.includes(file));
  const omittedNew = omittedFiles.length;
  const entries = patchEntries(diff, names);
  const fileDigests = entries && [
    ...entries.map(({ file, patch }) => [file, digest(patch)]),
    ...added.map(({ file, text }) => [file, digest(text)]),
  ];
  const changed = since ? changedReviewPaths(since.snapshot.fileDigests, fileDigests) : null;
  if (since && !changed?.length) throw new Error("No changed files could be verified against that review. Refresh the worktree or run a full review.");
  const currentFiles = new Set(fileDigests?.map(([file]) => file));
  const scopedDiff = since ? entries.filter(({ file }) => changed.includes(file)).map(({ patch }) => patch).join("") : diff;
  const sections = scopedDiff.split(/(?=^diff --git )/mu);
  let binaryOmitted = 0;
  const reviewDiff = sections.map((section) => {
    const binary = section.indexOf("\nGIT binary patch");
    if (binary >= 0) {
      binaryOmitted += 1;
      return section.slice(0, binary) + "\nBinary contents omitted.\n";
    }
    if (/^Binary files .+ differ$/mu.test(section)) binaryOmitted += 1;
    return section;
  }).join("");
  const scopedAdded = since ? added.filter(({ file }) => changed.includes(file)) : added;
  const diffTruncated = reviewDiff.length > maxDiff || diff.length >= 90000;
  const partial = Boolean(omittedNew || unavailableSelected.length || untrackedTruncated || diffTruncated || binaryOmitted || status.length >= 16000 || tracked.length >= 13000);
  const header = [
    target?.type === "commit" ? `Review commit ${head} against its first parent.`
      : `${target ? "Comparison branch " + target.ref : "Worktree base"}: ${base || head}\nCurrent HEAD: ${head}`,
    `${target?.type === "commit" ? "Paths changed in commit" : "Git status"} (may be truncated):\n${status}`,
    tracked && `Tracked path list (may be truncated):\n${tracked}`,
  ];
  const fullBody = [
    ...header,
    diff,
    omittedNew || untrackedTruncated ? `New files without contents: ${omittedNew}${untrackedTruncated ? " or more" : ""}.` : "",
    unavailableSelected.length ? "Some requested files were no longer untracked when the snapshot was captured." : "",
    ...added.map(({ file, text }) => `New source file ${JSON.stringify(file)}:\n${text}`),
  ].filter(Boolean).join("\n\n");
  const body = [
    ...header,
    since && `Incremental review against SHA-256 ${since.snapshot.sha256}. Changed files: ${JSON.stringify(changed)}.`,
    since && `Paths no longer included in the current review evidence: ${JSON.stringify(changed.filter((file) => !currentFiles.has(file)))}.`,
    `Tracked diff${diffTruncated ? " (truncated)" : ""}:\n${reviewDiff.slice(0, maxDiff)}`,
    partial ? "Review input is partial. Qualify findings to the evidence provided." : "",
    omittedNew || untrackedTruncated ? `New files without contents: ${omittedNew}${untrackedTruncated ? " or more" : ""}.` : "",
    unavailableSelected.length ? "Some requested files were no longer untracked when the snapshot was captured." : "",
    ...scopedAdded.map(({ file, text }) => `New source file ${JSON.stringify(file)}:\n${text}`),
  ].filter(Boolean).join("\n\n");
  return {
    body,
    hasChanges: Boolean(status.trim() || diff.trim()),
    info: {
      phase, capturedAt: new Date().toISOString(), head, base: base || head, ...(target && { target }),
      sha256: digest(body),
      ...(fileDigests && {
        fileDigests, worktreeSha256: digest(fullBody), selection: { includeNew: Boolean(includeNew), selectedFiles },
        ...(since && { sinceRun: since.id, changedFiles: changed }),
      }),
      diffTruncated, binaryOmitted, addedFiles, omittedNew, omittedFiles: omittedFiles.slice(0, 30), untrackedTruncated, unavailableSelected, partial,
    },
  };
}

module.exports = { reviewSnapshot, eligibleReviewPath, changedReviewPaths };
