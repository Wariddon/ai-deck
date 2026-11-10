const fs = require("node:fs/promises");
const path = require("node:path");

const transcriptName = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.jsonl$/iu;
const archiveDirectory = (projects) => path.join(projects, ".ai-deck-archive");

async function verifiedTranscript(root, file, id) {
  const base = await fs.realpath(root);
  const source = await fs.realpath(file);
  const parts = path.relative(base, source).split(path.sep);
  const equal = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (parts.length !== 2 || parts[0] === ".." || parts[0] === ".ai-deck-archive" || path.isAbsolute(parts[0]) ||
      !transcriptName.test(parts[1]) || parts[1].toLowerCase() !== id.toLowerCase() + ".jsonl" ||
      !equal(source, path.join(base, path.basename(path.dirname(file)), path.basename(file)))) {
    throw new Error("The Claude Code transcript location could not be verified.");
  }
  const stat = await fs.lstat(source);
  if (!stat.isFile()) throw new Error("Choose a regular local Claude Code transcript.");
  return { source, project: parts[0], filename: parts[1], stat };
}

async function transcriptDirectory(root, project) {
  const directory = path.join(root, project);
  await fs.mkdir(directory, { recursive: true });
  if (!(await fs.lstat(directory)).isDirectory() || path.resolve(directory) !== await fs.realpath(directory)) {
    throw new Error("The Claude Code transcript folder is linked or unavailable.");
  }
  return directory;
}

async function changeClaudeTranscript(projects, entry, action, title, ensureIdle) {
  const root = await fs.realpath(projects);
  const archive = archiveDirectory(root);
  const sourceRoot = entry.archived ? archive : root;
  if (!(await fs.lstat(sourceRoot)).isDirectory()) throw new Error("The transcript directory is linked or unavailable.");
  const { source, project, filename, stat } = await verifiedTranscript(sourceRoot, entry.file, entry.id);
  let destination;
  if (action === "archive" || action === "restore") {
    const targetRoot = action === "archive" ? await transcriptDirectory(root, ".ai-deck-archive") : root;
    destination = path.join(await transcriptDirectory(targetRoot, project), filename);
  }
  await ensureIdle();
  const current = await fs.lstat(source);
  if (!current.isFile() || current.nlink !== stat.nlink || current.ino !== stat.ino || current.size !== stat.size || current.mtimeMs !== stat.mtimeMs) {
    throw new Error("The Claude Code transcript changed. Pull sessions again.");
  }
  if (current.nlink !== 1) {
    const previousMove = destination && current.nlink === 2 ? await fs.lstat(destination).catch(() => null) : null;
    if (!previousMove?.isFile() || previousMove.ino !== current.ino || previousMove.dev !== current.dev) {
      throw new Error("This transcript has multiple file links. Resolve the source copy before continuing.");
    }
    await fs.unlink(source);
    return { ...entry, file: destination, archived: action === "archive" };
  }
  if (action === "rename") {
    const handle = await fs.open(source, "r+");
    try {
      const opened = await handle.stat();
      if (opened.ino !== current.ino || opened.size !== current.size || opened.mtimeMs !== current.mtimeMs) {
        throw new Error("The Claude Code transcript changed. Pull sessions again.");
      }
      const last = Buffer.alloc(1);
      if (opened.size) await handle.read(last, 0, 1, opened.size - 1);
      const line = (opened.size && last[0] !== 10 ? "\n" : "") + JSON.stringify({ type: "custom-title", customTitle: title, sessionId: entry.id }) + "\n";
      await handle.write(line, opened.size, "utf8");
    } finally { await handle.close(); }
    return { ...entry, title };
  }
  if (action === "delete") {
    await fs.unlink(source);
    return null;
  }
  // A hard link refuses an existing destination. Remove the new link if moving the source fails.
  await fs.link(source, destination);
  try { await fs.unlink(source); }
  catch (error) { await fs.unlink(destination).catch(() => {}); throw error; }
  return { ...entry, file: destination, archived: action === "archive" };
}

module.exports = { archiveDirectory, changeClaudeTranscript };
