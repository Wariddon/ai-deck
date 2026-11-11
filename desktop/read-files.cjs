const fs = require("node:fs/promises");
const path = require("node:path");
const { shareableDiffPath } = require("./review-snapshot.cjs");
const inside = (root, file) => { const rel = path.relative(root, file); return !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + path.sep); };
async function scopedFile(root, value) {
  if (typeof value !== "string" || value.length > 500 || !shareableDiffPath(value) || path.isAbsolute(value)) throw new Error("Choose a relative file inside the task folder.");
  const file = await fs.realpath(path.join(root, value));
  if (!inside(root, file)) throw new Error("The file leaves the task folder.");
  return file;
}
async function boundedText(filename, maximum, signal, onRead) {
  const handle = await fs.open(filename, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink > 1 || stat.size > maximum) throw new Error("Attach large or binary documents for extraction instead.");
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    onRead?.(offset);
    const after = await handle.stat();
    if (offset !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("The file changed while reading. Read it again.");
    const data = bytes.subarray(0, offset);
    if (data.includes(0)) throw new Error("Attach this binary document for extraction instead.");
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(data), size: offset };
  } finally { await handle.close(); }
}
async function readTaskFile(root, args, signal) {
  signal?.throwIfAborted(); root = await fs.realpath(root);
  const file = await scopedFile(root, args.file);
  const start = args.line ?? 1, count = args.lines ?? 120;
  if (!Number.isInteger(start) || start < 1 || start > 1000000 || !Number.isInteger(count) || count < 1 || count > 300) throw new Error("Choose a starting line and up to 300 lines.");
  const lines = (await boundedText(file, 2 * 1024 * 1024, signal)).text.split(/\r?\n/u);
  const selected = []; let used = 0;
  for (let i = start - 1; i < Math.min(lines.length, start - 1 + count); i++) {
    const row = { line: i + 1, text: lines[i].slice(0, 2000), ...(lines[i].length > 2000 && { clipped: true }) };
    used += JSON.stringify(row).length;
    if (used > 12000) break;
    selected.push(row);
  }
  return { source: "Task files", text: JSON.stringify({ file: args.file, totalLines: lines.length, start,
    lines: selected, truncated: selected.length < Math.min(count, Math.max(0, lines.length - start + 1)) }) };
}
async function searchTaskFiles(root, args, signal) {
  root = await fs.realpath(root);
  if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 160 || /[\x00-\x1f]/u.test(args.query)) throw new Error("Choose a short literal search phrase.");
  const pending = [""], matches = [], query = args.query.toLocaleLowerCase(); let visited = 0, bytesRead = 0, used = 0;
  while (pending.length && visited < 4000 && matches.length < 60 && bytesRead < 12 * 1024 * 1024) {
    signal?.throwIfAborted(); const folder = pending.shift();
    const directory = await fs.opendir(path.join(root, folder)).catch(() => null); if (!directory) continue;
    for await (const entry of directory) {
      signal?.throwIfAborted();
      if (++visited > 4000 || matches.length >= 60 || bytesRead >= 12 * 1024 * 1024) break;
      const relative = path.join(folder, entry.name).replaceAll("\\", "/");
      if (entry.isSymbolicLink() || !shareableDiffPath(relative)) continue;
      if (entry.isDirectory()) { if (!/^(?:node_modules|dist|build|coverage|\.git|\.venv|vendor)$/iu.test(entry.name)) pending.push(relative); continue; }
      if (!entry.isFile()) continue;
      const filename = await scopedFile(root, relative).catch(() => null); if (!filename) continue;
      const data = await boundedText(filename, Math.min(512 * 1024, 12 * 1024 * 1024 - bytesRead), signal,
        size => { bytesRead += size; }).catch(() => null);
      if (!data) continue;
      const lines = data.text.split(/\r?\n/u);
      for (let n = 0; n < lines.length && matches.length < 60; n++) if (lines[n].toLocaleLowerCase().includes(query)) {
        const match = { file: relative, line: n + 1, text: lines[n].slice(0, 400) };
        used += JSON.stringify(match).length;
        if (used > 12000) { pending.length = 0; visited = 4000; break; }
        matches.push(match);
      }
    }
  }
  return { source: "Task files", text: JSON.stringify({ query: args.query, matches, bounded: true, visited, bytesRead,
    truncated: pending.length > 0 || visited >= 4000 || matches.length >= 60 || bytesRead >= 12 * 1024 * 1024 }) };
}
module.exports = { readTaskFile, searchTaskFiles };
