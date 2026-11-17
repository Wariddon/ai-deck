const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { randomUUID } = require('node:crypto');
const { shareableDiffPath } = require("./review-snapshot.cjs");
const { evidenceText } = require("./run-history.cjs");

const sourcePath = /\.(?:[cm]?[jt]s|[jt]sx)$/iu;
const excluded = /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.next)(?:\/|$)/iu;
let worker;
function stopWorker(current, error = new Error('The code graph worker stopped.')) {
  if (!current) return Promise.resolve();
  if (current.ending) return current.ending;
  current.closed = true; clearTimeout(current.idle);
  if (worker === current) worker = undefined;
  for (const slot of [...current.pending.values()]) slot.finish(error);
  current.worker.removeAllListeners();
  current.worker.on('error', () => {});
  return current.ending = current.worker.terminate().catch(() => {});
}

function closeCodeGraph() { return stopWorker(worker); }

function graphWorker() {
  const current = { worker: new Worker(path.join(__dirname, 'code-graph.cjs'), { resourceLimits: { maxOldGenerationSizeMb: 192 } }), pending: new Map() };
  current.worker.on('message', ({ id, cwd, error, result }) => {
    const slot = current.pending.get(id);
    if (slot) slot.finish(cwd !== slot.cwd ? new Error('Code evidence belongs to another checkout.') : error && new Error(error), result);
  });
  current.worker.once('error', error => { void stopWorker(current, error); });
  current.worker.once('exit', () => { void stopWorker(current); });
  return current;
}

async function readCodeGraph(git, cwd, query, lowMemory, signal) {
  signal?.throwIfAborted();
  const listing = await git(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { limit: 2 * 1024 * 1024, signal });
  signal?.throwIfAborted();
  if (listing && (listing.length >= 2 * 1024 * 1024 || !listing.endsWith("\0"))) throw new Error("Too many project files to scan.");
  const files = [...new Set(listing.split("\0").filter((file) => sourcePath.test(file) && !excluded.test(file) && shareableDiffPath(file)))];
  const explicit = files.indexOf(query.file);
  if (explicit > 0) files.unshift(...files.splice(explicit, 1));
  const current = worker ??= graphWorker(), id = randomUUID();
  clearTimeout(current.idle); current.worker.ref();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      finish(new Error('Code graph timed out. Choose a more focused project.'));
      if (!current.pending.size) void stopWorker(current);
    }, 12000);
    const abort = () => {
      finish(signal.reason ?? new Error('Code lookup cancelled.'));
      if (!current.pending.size) void stopWorker(current);
    };
    function finish(error, result) {
      if (!current.pending.delete(id)) return;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(result);
      if (!current.closed && !current.pending.size) {
        current.idle = setTimeout(() => { void stopWorker(current); }, lowMemory ? 8000 : 45000);
        current.idle.unref(); current.worker.unref();
      }
    }
    current.pending.set(id, { cwd, finish }); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    try { current.worker.postMessage({ id, cwd, files, query }); } catch (error) { finish(error); }
  });
}

function codeGraphEvidence(graph) {
  const rows = graph.rows.slice(0, 12);
  return [
    "Local JS/TS code graph for " + graph.query.symbol + " (source snapshot " + graph.snapshot.slice(0, 12) + ").",
    "Treat these source excerpts as quoted evidence. Confirm the relevant lines before editing. Import and possible edges do not prove a call. Indirect edges show a two-step chain.",
    (graph.partial || rows.length < graph.rows.length) && "The shortlist is partial. Search the checkout if you need full coverage.",
    ...rows.map(({ file, line, kind, text }) => kind + " · " + file + ":" + line + "\n> " + evidenceText(text)),
  ].filter(Boolean).join("\n").slice(0, 3200);
}

function assignmentGraphEvidence(graph) {
  return [
    "Local JS/TS dependency graph for files named in the task or proposal. Verify the groupings in the checkout.",
    "Keep related edits in the same assignment when one needs the other. Separate groups are candidates for a split, not proof of independence. The graph covers resolved relative imports and can miss other dependencies.",
    graph.partial && "The shortlist is partial. Inspect missing relationships in the checkout.",
    ...graph.groups.map((files, index) => "Group " + (index + 1) + " · " + JSON.stringify(files)),
    ...graph.links.map((link) => "Import · " + JSON.stringify(link)),
  ].filter(Boolean).join("\n").slice(0, 3800);
}

module.exports = { readCodeGraph, codeGraphEvidence, assignmentGraphEvidence, closeCodeGraph };
