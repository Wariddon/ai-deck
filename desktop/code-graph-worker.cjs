const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { shareableDiffPath } = require("./review-snapshot.cjs");
const { evidenceText } = require("./run-history.cjs");

const sourcePath = /\.(?:[cm]?[jt]s|[jt]sx)$/iu;
const excluded = /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.next)(?:\/|$)/iu;
let worker;
let idleTimer;

function closeCodeGraph() {
  clearTimeout(idleTimer);
  const current = worker;
  worker = undefined;
  if (current) void current.terminate();
}

async function readCodeGraph(git, cwd, query, lowMemory) {
  const listing = await git(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { limit: 2 * 1024 * 1024 });
  if (listing && (listing.length >= 2 * 1024 * 1024 || !listing.endsWith("\0"))) throw new Error("Too many project files to scan.");
  const files = [...new Set(listing.split("\0").filter((file) => sourcePath.test(file) && !excluded.test(file) && shareableDiffPath(file)))];
  const explicit = files.indexOf(query.file);
  if (explicit > 0) files.unshift(...files.splice(explicit, 1));
  clearTimeout(idleTimer);
  const current = worker ??= new Worker(path.join(__dirname, "code-graph.cjs"),
    { resourceLimits: { maxOldGenerationSizeMb: 192 } });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      closeCodeGraph();
      done(new Error("Code graph timed out. Choose a more focused project."));
    }, 12000);
    function done(error, result) {
      clearTimeout(timeout);
      current.off("message", onMessage);
      current.off("error", onError);
      current.off("exit", onExit);
      if (error) reject(error);
      else resolve(result);
    }
    function onMessage({ error, result }) {
      idleTimer = setTimeout(closeCodeGraph, lowMemory ? 8000 : 45000);
      idleTimer.unref();
      done(error && new Error(error), result);
    }
    function onError(error) {
      if (worker === current) closeCodeGraph();
      done(error);
    }
    function onExit() {
      if (worker === current) worker = undefined;
      done(new Error("The code graph worker stopped."));
    }
    current.once("message", onMessage);
    current.once("error", onError);
    current.once("exit", onExit);
    current.postMessage({ cwd, files, query });
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
