const { capture } = require("./engines.cjs");
const { abortableRead } = require("./abortable-read.cjs");

function nativeCloudRequest(prompt) {
  return typeof prompt === "string" && /(?:codex\s*cloud|คลาวด์\s*codex|งาน\s*cloud)/iu.test(prompt);
}
async function readNativeCloud(exe, { action = "list", id } = {}, { cwd, signal, run = capture, timeout = 18000 } = {}) {
  if (!exe) throw new Error("Connect the Codex CLI before reading Codex Cloud.");
  if (!["list", "status", "diff"].includes(action)) throw new Error("Choose a read-only Codex Cloud action.");
  if (action !== "list" && (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,119}$/iu.test(id))) throw new Error("Choose a valid Codex Cloud task ID.");
  const argv = action === "list" ? ["cloud", "list", "--json", "--limit", "20"] : ["cloud", action, id];
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Codex Cloud reading timed out. Try again when the connection is ready.")), timeout);
  let response;
  try {
    response = await abortableRead(() => run(exe, argv, { cwd, signal: controller.signal, timeout, limit: 256 * 1024 }), controller.signal);
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  if (response.code !== 0 || typeof response.stdout !== "string") throw new Error("Codex Cloud could not be read. Check the CLI connection and signed-in account.");
  const text = response.stdout;
  if (action !== "list") return { source: "Codex Cloud CLI", action, id, text: text.slice(0, 16000), truncated: text.length > 16000 };
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("The Codex CLI returned an unreadable Cloud task list."); }
  if (!Array.isArray(data?.tasks)) throw new Error("This Codex CLI does not report a supported Cloud task list.");
  const seen = new Set();
  const tasks = data.tasks.slice(0, 20).filter(task => task && typeof task === "object").map(task => ({
    id: String(task.id ?? task.task_id ?? "").slice(0, 120),
    title: String(task.title ?? task.prompt ?? "Cloud task").slice(0, 300),
    status: String(task.status ?? "unknown").slice(0, 80),
  })).filter(task => {
    if (!/^[a-z0-9][a-z0-9_-]{0,119}$/iu.test(task.id) || seen.has(task.id)) return false;
    seen.add(task.id); return true;
  });
  return { source: "Codex Cloud CLI", action, tasks, more: Boolean(data.cursor) };
}
module.exports = { readNativeCloud, nativeCloudRequest };
