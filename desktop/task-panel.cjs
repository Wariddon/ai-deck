const fs = require("node:fs");
const path = require("node:path");

const supportedImage = (filename) => /\.(?:png|jpe?g)$/iu.test(filename);
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
const previewPattern = /(?<![\p{L}\d./@-])(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]):\d{1,5}(?:\/[^\s<>"'\x60()[\]?#]*)?(?![\p{L}\d.-])/giu;

function safeLink(input) {
  if (typeof input !== "string" || input.length > 2000 || /[\u0000-\u001f\u007f]/u.test(input)) return null;
  const url = URL.parse(input.trim());
  return url && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : null;
}

function localPreviews(text) {
  const links = new Set();
  for (const match of (typeof text === "string" ? text.slice(-16000) : "").matchAll(previewPattern)) {
    const value = match[0].replace(/[.,;!]+$/u, "");
    const url = safeLink(/^https?:\/\//iu.test(value) ? value : "http://" + value);
    if (url && loopback.has(url.hostname)) links.add(url.href);
    if (links.size >= 8) break;
  }
  return [...links];
}

function recordPanelEvidence(run, agent, event, redact) {
  if (event.type === "web-source") {
    const detail = redact(event.detail);
    if (!detail) return false;
    const entries = run.panelSearches ?? [];
    if (entries.some((entry) => entry.agent === agent && entry.kind === event.kind && entry.detail === detail)) return false;
    run.panelSearches = [...entries, { agent, kind: event.kind === "fetch" ? "fetch" : "search", detail }].slice(-16);
    return true;
  }
  const text = ["message", "answer"].includes(event.type) ? event.text : event.type === "command-result" ? event.output : "";
  if (!text) return false;
  const entries = run.panelLinks ?? [];
  const next = localPreviews(text).filter((url) => !entries.some((entry) => entry.url === url));
  if (!next.length) return false;
  run.panelLinks = [...entries, ...next.map((url) => ({ url, agent }))].slice(-12);
  return true;
}

function linkRow(url, extra = {}) {
  const parsed = safeLink(url);
  if (!parsed) return null;
  return { id: "link:" + parsed.href, kind: "link", url: parsed.href, name: parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname), ...extra };
}

function distinct(rows, limit) {
  const seen = new Set();
  return rows.filter((row) => row && !seen.has(row.id) && seen.add(row.id)).slice(0, limit);
}

function taskRows(task, gitImages = []) {
  const outputs = [];
  const sources = [];
  for (const entry of [...(task.panelEntries ?? [])].reverse()) {
    (entry.section === "outputs" ? outputs : sources).push(entry.url
      ? linkRow(entry.url, { id: entry.id, name: entry.name, manual: true })
      : { id: entry.id, kind: supportedImage(entry.filename) ? "image" : "file", name: entry.name, manual: true });
  }
  const history = [...task.runHistory].reverse();
  for (const run of history) {
    const links = run.panelLinks ?? Object.entries(run.agents ?? {}).flatMap(([agent, record]) =>
      localPreviews(record.answer ?? record.messages?.at(-1)?.text).map((url) => ({ url, agent })));
    for (const entry of links) outputs.push(linkRow(entry.url, { agent: entry.agent, detail: "Reported preview URL" }));
    for (const entry of run.panelImages ?? []) outputs.push({ id: entry.id, kind: "image", name: "Generated image",
      detail: path.basename(entry.filename), agent: entry.agent });
    for (const image of [...(run.images ?? []), ...(run.timeline ?? []).flatMap((entry) => entry.images ?? [])]) {
      sources.push({ id: "attachment:" + image.id, kind: "image", name: image.name, detail: "Task attachment" });
    }
    for (const note of run.panelContext ?? (run.skills ?? []).map((skill) => ({ ...skill, source: "Skill" }))) {
      sources.push({ id: "note:" + note.id, kind: "file", name: note.name, detail: note.source + " · Shared context" });
    }
    for (const [, name] of (run.prompt ?? "").matchAll(/^\[Attached text · ([^\r\n]{1,180})\]$/gmu)) {
      sources.push({ id: "text:" + name, kind: "file", name, detail: "Text attached to task" });
    }
    for (const entry of run.panelSearches ?? []) {
      sources.push({ id: ["web", entry.agent, entry.kind, entry.detail].join(":"), kind: "search",
        name: entry.kind === "fetch" ? "Web fetch" : "Web search", detail: entry.detail, agent: entry.agent });
    }
  }
  const generated = new Set(history.flatMap((run) => (run.panelImages ?? []).map((entry) => entry.filename)));
  const images = gitImages.filter(({ filename }) => !generated.has(filename)).map(({ lane, relative }) => ({ id: "worktree:" + lane + ":" + relative, kind: "image",
    name: path.posix.basename(relative), detail: relative, agent: lane === "claude" ? "claude" : undefined }));
  return { outputs: distinct([...outputs, ...images], 44), sources: distinct(sources, 60) };
}

function confinedImage(filename, roots) {
  if (typeof filename !== "string" || !path.isAbsolute(filename) || !supportedImage(filename)) return null;
  try {
    if (!fs.lstatSync(filename).isFile()) return null;
    const resolved = fs.realpathSync(filename);
    for (const root of roots.filter(Boolean)) {
      try {
        const inside = path.relative(fs.realpathSync(root), resolved);
        if (inside && !inside.startsWith(".." + path.sep) && inside !== ".." && !path.isAbsolute(inside)) return resolved;
      } catch {}
    }
  } catch {}
  return null;
}

function worktreeImage(task, id) {
  const match = /^worktree:(main|claude):(.+)$/us.exec(id);
  const root = match?.[1] === "claude" ? task.claudeWorktree : task.worktree;
  const relative = match?.[2];
  if (!root || !relative || !supportedImage(relative) || /[\\:\u0000-\u001f]/u.test(relative) ||
      relative.split("/").some((part) => !part || [".", "..", ".git"].includes(part.toLowerCase()))) return null;
  return confinedImage(path.join(root, ...relative.split("/")), [root]);
}

module.exports = { safeLink, localPreviews, recordPanelEvidence, taskRows, supportedImage, worktreeImage, confinedImage };
