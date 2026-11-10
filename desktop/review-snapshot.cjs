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

function shareableDiffPath(relative) {
  if (typeof relative !== "string" || !relative || relative.length > 1024 || /[\\:\0]/u.test(relative)) return false;
  if (relative.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) return false;
  return !sensitivePath.test(relative) && !/(?:^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)|\.npmrc|\.netrc|\.pypirc)(?:$|\/)|\.(?:pem|key|pfx|p12)$/iu.test(relative);
}

function eligibleReviewPath(relative) {
  if (!shareableDiffPath(relative)) return false;
  const name = path.basename(relative);
  return sourceExtensions.has(path.extname(name).toLowerCase()) || ["Dockerfile", "Makefile"].includes(name);
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

async function supplementalReviewDiff(git, cwd, base = "HEAD") {
  const limit = 90000;
  const raw = await git(cwd, ["diff", "--patch-with-raw", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", "--no-relative",
    "--no-color", "--ignore-submodules=all", "--diff-filter=AMD", "--output-indicator-new=+", "--output-indicator-old=-",
    "--output-indicator-context= ", base, "--"], { limit });
  if (!raw) return "";
  const omitted = "Tracked diff omitted because the patch could not be verified within the size limit.";
  const split = raw.indexOf("\0\0");
  if (split < 0 || raw.length >= limit) return omitted;
  // Pair paths and patches from one Git snapshot. A separate filename query can race with edits.
  const header = raw.slice(0, split).split("\0");
  const sections = raw.slice(split + 2).split(/(?=^diff --git )/mu);
  if (header.length !== sections.length * 2 || sections.some((section) => !section.startsWith("diff --git ") || section.includes("\0"))) return omitted;
  const eligible = sections.filter((section, index) => {
    const metadata = header[index * 2];
    const file = header[index * 2 + 1];
    return /^:(?:000000|100644|100755) (?:000000|100644|100755) [a-f\d]+ [a-f\d]+ [AMD]$/u.test(metadata) &&
      shareableDiffPath(file) && !/[\u0000-\u001f\ufffd]/u.test(file) &&
      !/(?:^|\/)(?:\.git-credentials|\.docker\/config\.json|\.kube\/config|\.yarnrc\.yml)(?:$|\/)|\.tfstate(?:$|\.)/iu.test(file) &&
      !/^(?:Binary files .* differ|GIT binary patch)$/mu.test(section);
  });
  const diff = eligible.join("");
  const partial = diff.length > 32000 || eligible.length !== sections.length;
  return [diff.slice(0, 32000), partial && "Some tracked changes were omitted due to file type, sensitivity, or size."].filter(Boolean).join("\n");
}

function changedReviewPaths(before, after) {
  if (!before || !after) return null;
  const previous = new Map(before);
  const current = new Map(after);
  return [...new Set([...previous.keys(), ...current.keys()])].filter((file) => previous.get(file) !== current.get(file));
}

function reviewSnapshot({ cwd, head, base, diff, status, tracked, untracked, phase, includeNew, selectedFiles, target,
  names, since, compact, changedPaths, scopeUncertain, untrackedTruncated = false }) {
  const maxDiff = compact?.diffLimit ?? 32000;
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
  if (since && (!changed || !changed.length && !since.allowUnchanged)) throw new Error("No changed files could be verified against that review. Refresh the worktree or run a full review.");
  const currentFiles = new Set(fileDigests?.map(([file]) => file));
  const delta = compact && (changedPaths ?? (since && changed));
  const newPaths = fileNames.filter((file) => !delta || delta.includes(file));
  const changedSet = new Set(delta);
  const compactEntries = compact ? (entries ?? []).filter(({ file }) => !delta || changedSet.has(file)) : [];
  const sharedEntries = compactEntries.filter(({ file }) => shareableDiffPath(file));
  const hiddenTracked = compact && (!entries && Boolean(diff) || sharedEntries.length < compactEntries.length);
  const scopedDiff = compact ? sharedEntries.map(({ patch }) => patch).join("")
    : since ? entries.filter(({ file }) => changed.includes(file)).map(({ patch }) => patch).join("") : diff;
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
  let remainingNew = compact?.newLimit;
  const scopedAdded = compact ? added.filter(({ file, text }) => {
    const bytes = Buffer.byteLength(text);
    if (!newPaths.includes(file) || bytes > remainingNew) return false;
    remainingNew -= bytes;
    return true;
  })
    : since ? added.filter(({ file }) => changed.includes(file)) : added;
  const sentNew = scopedAdded.map(({ file }) => file);
  const missingNew = compact ? newPaths.filter((file) => !sentNew.includes(file)).length : omittedNew;
  const diffTruncated = reviewDiff.length > maxDiff || diff.length >= 90000;
  const partial = Boolean(scopeUncertain || missingNew || hiddenTracked || unavailableSelected.length || untrackedTruncated || diffTruncated || binaryOmitted ||
    (compact ? !fileDigests : status.length >= 16000 || tracked.length >= 13000));
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
    ...(compact ? [header[0],
      scopeUncertain && "The full change scope could not be verified against the checkout before the build.",
      delta?.some((file) => !currentFiles.has(file)) && "Some earlier changes were reverted. Their current content matches the base or is absent.",
      hiddenTracked && "Some tracked changes were excluded from the review packet.",
      !scopeUncertain && !untrackedTruncated && `Untracked files in the review scope: ${newPaths.length}.`] : header),
    since && `Incremental review against SHA-256 ${since.snapshot.sha256}. Changed files: ${JSON.stringify(changed)}.`,
    since?.allowUnchanged && !changed.length && "The recorded diff matches this checkout. No changed lines to resend. Use the selected excerpt and recorded checks.",
    since && `Paths no longer included in the current review evidence: ${JSON.stringify(changed.filter((file) => !currentFiles.has(file)))}.`,
    `Tracked diff${diffTruncated ? " (truncated)" : ""}:\n${reviewDiff.slice(0, maxDiff)}`,
    partial ? "Review input is partial. Qualify findings to the evidence provided." : "",
    missingNew || untrackedTruncated ? `New files without contents: ${missingNew}${untrackedTruncated ? " or more" : ""}.` : "",
    unavailableSelected.length ? "Some requested files were no longer untracked when the snapshot was captured." : "",
    ...scopedAdded.map(({ file, text }) => `New source file ${JSON.stringify(file)}:\n${text}`),
  ].filter(Boolean).join("\n\n");
  return {
    body,
    hasChanges: Boolean(delta ? delta.length || newPaths.length || partial : scopeUncertain || status.trim() || diff.trim()),
    info: {
      phase, capturedAt: new Date().toISOString(), head, base: base || head, ...(target && { target }),
      sha256: digest(body),
      ...(fileDigests && {
        fileDigests, worktreeSha256: digest(fullBody), selection: { includeNew: Boolean(includeNew), selectedFiles },
        ...(since && { sinceRun: since.id, changedFiles: changed }),
      }),
      ...(compact && { includedPaths: [...sharedEntries.map(({ file }) => file), ...scopedAdded.map(({ file }) => file)].slice(0, 80) }),
      diffTruncated, binaryOmitted, addedFiles: compact ? sentNew : addedFiles, omittedNew: missingNew,
      omittedFiles: (compact ? newPaths.filter((file) => !sentNew.includes(file)) : omittedFiles).slice(0, 30),
      untrackedTruncated, unavailableSelected, partial,
    },
  };
}

module.exports = { reviewSnapshot, supplementalReviewDiff, eligibleReviewPath, changedReviewPaths, shareableDiffPath, readNewSource };
