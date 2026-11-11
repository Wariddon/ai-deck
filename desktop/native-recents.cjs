const fs = require("node:fs/promises");
const path = require("node:path");
const { nativeChatDelivery } = require("./native-chat-delivery.mjs");

const recentLimit = 40;
const messageLimit = 32;
const maxText = 24000;
const claudePageBytes = 2 * 1024 * 1024;
const claudeSessionFile = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.jsonl$/iu;
const claudeMetadataCache = new Map();
const metadataCacheLimit = 160;

function displayTitle(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const title = value.replace(/^\s*Task from the user:\s*/u, "").trim().split(/\r?\n/u, 1)[0].trim();
    if (title) return title.slice(0, 200);
  }
  return "Untitled session";
}

function projectLabel(cwd) {
  return typeof cwd === "string" ? cwd.split(/[\\/]/u).filter(Boolean).at(-1)?.slice(0, 110) ?? "" : "";
}

async function listCodexSessions(engine, archived = false) {
  const result = await engine.request("thread/list", {
    limit: recentLimit, archived, sortKey: "updated_at", sortDirection: "desc", modelProviders: [],
    sourceKinds: ["vscode", "appServer", "cli", "exec", "unknown"], useStateDbOnly: true,
  });
  if (!Array.isArray(result?.data)) throw new Error("Codex did not return a session list.");
  return result.data.filter((entry) => typeof entry?.id === "string" && entry.id && !entry.ephemeral).slice(0, recentLimit)
    .map((entry) => ({
      provider: "codex", id: entry.id, title: displayTitle(entry.name, entry.preview), project: projectLabel(entry.cwd),
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt * 1000 : 0,
      cwd: entry.cwd, branch: entry.gitInfo?.branch,
      ...(archived && { archived: true }),
    }));
}

function textContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text).join("\n").trim();
}

function visibleMessage(id, role, text, at) {
  return { id, role, text: text.slice(0, maxText), clipped: text.length > maxText,
    ...(Number.isFinite(at) && at > 0 && { at }) };
}

async function readCodexSession(engine, id, cursor) {
  const result = await engine.request("thread/turns/list", {
    threadId: id, limit: 8, sortDirection: "desc", itemsView: "summary", ...(cursor && { cursor }),
  });
  if (!Array.isArray(result?.data)) throw new Error("Codex did not return the stored messages.");
  const messages = result.data.flatMap((turn, turnIndex) => {
    if (!Array.isArray(turn?.items)) return [];
    return [...turn.items].reverse().flatMap((item, itemIndex) => {
      const key = `${turn?.id ?? `${cursor ?? "latest"}:${turnIndex}`}:${item?.id ?? itemIndex}`;
      const startedAt = Number.isFinite(turn?.startedAt) ? turn.startedAt * 1000 : undefined;
      const completedAt = Number.isFinite(turn?.completedAt) ? turn.completedAt * 1000 : startedAt;
      if (item?.type === "userMessage") return [visibleMessage(key, "user", textContent(item.content), startedAt)];
      if (item?.type === "agentMessage" && typeof item.text === "string" && item.phase !== "commentary") {
        return [visibleMessage(key, "assistant", item.text.trim(), completedAt)];
      }
      return [];
    });
  }).filter(({ text }) => text);
  return { messages, cursor: result.nextCursor ?? null,
    active: result.data.some((turn) => turn?.status === "inProgress") };
}

async function localTranscript(file, root, read) {
  const [resolved, boundary] = await Promise.all([fs.realpath(file), fs.realpath(root)]);
  const relative = path.relative(boundary, resolved);
  if (path.isAbsolute(relative) || relative.startsWith(".." + path.sep) || relative.split(path.sep).length !== 2 ||
      !claudeSessionFile.test(path.basename(relative)) || !(await fs.lstat(file)).isFile()) {
    throw new Error("This is not a local Claude Code transcript.");
  }
  const handle = await fs.open(resolved, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("This Claude Code session is unavailable.");
    return await read(handle, stat.size);
  } finally {
    await handle.close();
  }
}

async function readRegion(handle, size, limit, tail = false) {
  const length = Math.min(size, limit);
  if (!length) return [];
  const start = tail ? size - length : 0;
  const buffer = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(buffer, 0, length, start);
  const lines = buffer.toString("utf8", 0, bytesRead).split(/\r?\n/u);
  if (start > 0) lines.shift();
  if (start + bytesRead < size) lines.pop();
  return lines.flatMap((line) => {
    if (!line) return [];
    const entry = parseLine(line);
    return entry ? [entry] : [];
  });
}

function claudeMessage(entry) {
  if (!entry || entry.isSidechain || entry.isMeta || !["user", "assistant"].includes(entry.type)) return null;
  const text = textContent(entry.message?.content);
  if (!text || /^<(?:system-reminder|local-command|command-|task-notification|bash-stdin|user-prompt-submit-hook)/iu.test(text)) return null;
  return { role: entry.type, text };
}

async function claudeMetadata(candidate, root) {
  const { id, file, updatedAt } = candidate;
  return localTranscript(file, root, async (handle, size) => {
    const first = await readRegion(handle, size, 192 * 1024);
    const last = size > 192 * 1024 ? await readRegion(handle, size, 192 * 1024, true) : first;
    const own = (entry) => entry && !entry.isSidechain && (!entry.sessionId || entry.sessionId.toLowerCase?.() === id);
    const title = last.findLast((entry) => own(entry) && typeof entry.customTitle === "string")?.customTitle ??
      first.findLast((entry) => own(entry) && typeof entry.customTitle === "string")?.customTitle;
    const summary = last.findLast((entry) => own(entry) && (typeof entry.aiTitle === "string" || entry.type === "summary")) ??
      first.findLast((entry) => own(entry) && (typeof entry.aiTitle === "string" || entry.type === "summary"));
    const prompt = first.find((entry) => own(entry) && entry.type === "user" && claudeMessage(entry)) ??
      last.find((entry) => own(entry) && entry.type === "user" && claudeMessage(entry));
    const origin = last.findLast((entry) => own(entry) && typeof entry.cwd === "string") ??
      first.find((entry) => own(entry) && typeof entry.cwd === "string");
    if (!title && !summary && !prompt && !origin) return null;
    return {
      provider: "claude", id, file, updatedAt, project: projectLabel(origin?.cwd),
      title: displayTitle(title, summary?.aiTitle, summary?.summary, claudeMessage(prompt)?.text),
      cwd: origin?.cwd, branch: (last.findLast((entry) => own(entry) && typeof entry.gitBranch === "string") ??
        first.findLast((entry) => own(entry) && typeof entry.gitBranch === "string"))?.gitBranch,
    };
  });
}

async function entriesAt(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function cachedClaudeMetadata(candidate, root) {
  const key = path.resolve(root) + "\n" + candidate.file;
  const stamp = [candidate.updatedAt, candidate.size, candidate.changedAt, candidate.device, candidate.inode].join(":");
  const cached = claudeMetadataCache.get(key);
  if (cached?.stamp === stamp) {
    claudeMetadataCache.delete(key);
    claudeMetadataCache.set(key, cached);
    return { ...cached.row };
  }
  const row = await claudeMetadata(candidate, root);
  if (row) {
    claudeMetadataCache.delete(key);
    claudeMetadataCache.set(key, { stamp, row: { ...row } });
    if (claudeMetadataCache.size > metadataCacheLimit) claudeMetadataCache.delete(claudeMetadataCache.keys().next().value);
  } else claudeMetadataCache.delete(key);
  return row;
}

async function listClaudeSessions(root, { signal } = {}) {
  signal?.throwIfAborted();
  const candidates = [];
  const folders = (await entriesAt(root)).filter((entry) => entry.isDirectory());
  for (const folder of folders) {
    signal?.throwIfAborted();
    const dir = path.join(root, folder.name);
    for (const file of await entriesAt(dir)) {
      if (file.isFile() && claudeSessionFile.test(file.name)) {
        candidates.push({ file: path.join(dir, file.name), id: file.name.slice(0, -6).toLowerCase() });
      }
    }
  }
  for (let index = 0; index < candidates.length; index += 24) {
    signal?.throwIfAborted();
    await Promise.all(candidates.slice(index, index + 24).map(async (candidate) => {
      try {
        const stat = await fs.stat(candidate.file);
        Object.assign(candidate, { updatedAt: stat.mtimeMs, size: stat.size, changedAt: stat.ctimeMs, device: stat.dev, inode: stat.ino });
      } catch {}
    }));
  }
  const sorted = candidates.filter(({ updatedAt }) => updatedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  const rows = [];
  const seen = new Set();
  for (const candidate of sorted) {
    signal?.throwIfAborted();
    if (seen.has(candidate.id)) continue;
    const row = await cachedClaudeMetadata(candidate, root).catch(() => null);
    if (!row) continue;
    rows.push(row);
    seen.add(candidate.id);
    if (rows.length >= recentLimit) break;
  }
  return rows;
}

async function readClaudeSession(root, entry, cursor) {
  return localTranscript(entry.file, root, async (handle, size) => {
    const end = cursor?.end ?? size;
    if (end > size) throw new Error("The transcript changed. Reopen this session.");
    if (!end) return { messages: [], cursor: null };
    const start = Math.max(0, end - claudePageBytes);
    // Include the preceding byte to detect an exact line boundary.
    const readStart = Math.max(0, start - 1);
    const bytes = Buffer.allocUnsafe(end - readStart);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, readStart);
    if (bytesRead !== bytes.length) throw new Error("The transcript changed. Reopen this session.");
    const first = start === 0 ? 0 : bytes.indexOf(10) + 1;
    if (start && (!first || first === bytes.length)) {
      return { messages: [], cursor: { end: start, discard: true }, skipped: true };
    }
    const messages = [];
    let lineEnd = cursor?.discard ? bytes.lastIndexOf(10) : bytes.length;
    while (lineEnd > first) {
      const lineStart = bytes.lastIndexOf(10, lineEnd - 1) + 1;
      if (lineStart < first) break;
      const line = bytes.toString("utf8", lineStart, lineEnd).trim();
      const record = parseLine(line);
      if (record?.sessionId?.toLowerCase?.() === entry.id) {
        const message = claudeMessage(record);
        if (message) messages.push(visibleMessage(String(readStart + lineStart), message.role, message.text, Date.parse(record.timestamp)));
      }
      if (messages.length === messageLimit) {
        const older = readStart + lineStart;
        return { messages, cursor: older ? { end: older } : null };
      }
      lineEnd = lineStart - 1;
    }
    const older = readStart + first;
    return { messages, cursor: older ? { end: older } : null };
  });
}

async function findClaudeSession(root, id) {
  if (typeof id !== "string" || !claudeSessionFile.test(id + ".jsonl")) return null;
  let found = null;
  for (const folder of await entriesAt(root)) {
    if (!folder.isDirectory()) continue;
    const file = path.join(root, folder.name, id + ".jsonl");
    const stat = await fs.lstat(file).catch(() => null);
    if (stat?.isFile() && (!found || stat.mtimeMs > found.updatedAt)) {
      found = { id: id.toLowerCase(), file, updatedAt: stat.mtimeMs };
    }
  }
  return found;
}

function parseLine(line) {
  if (!line) return null;
  try { return JSON.parse(line); } catch { return null; }
}

module.exports = { listCodexSessions, readCodexSession, listClaudeSessions, readClaudeSession, findClaudeSession, nativeChatDelivery };
