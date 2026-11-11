const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { queryCodeGraph, assignmentGraph } = require("../desktop/code-graph.cjs");
const { codeGraphQuery } = require("../desktop/code-graph-query.mjs");

test("symbol graph separates aliases, imports, dynamic targets and same-named definitions", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-graph-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = {
    "layout.ts": "export function applyLayout(items: string[]) { return items; }",
    "page.tsx": "import { applyLayout as arrange } from './layout';\nexport const render = () => arrange([]);",
    "registry.ts": "import { applyLayout } from './layout';\nexport const layouts = { applyLayout };",
    "dispatch.ts": "import { layouts } from './registry';\nexport const dispatch = (name: keyof typeof layouts) => layouts[name]([]);",
    "layout.test.ts": "import { render } from './page';\nassert.deepEqual(render(), []);",
    "unrelated.ts": "export function applyLayout() {}\napplyLayout();",
  };
  for (const [file, content] of Object.entries(sources)) fs.writeFileSync(path.join(root, file), content);
  const symbol = { symbol: "applyLayout" };
  assert.equal(queryCodeGraph(root, Object.keys(sources), { ...symbol, kind: "callers" }).ambiguous, true);
  const query = { ...symbol, file: "layout.ts", kind: "impact" };
  const first = queryCodeGraph(root, Object.keys(sources), query);
  assert.deepEqual(first.rows.map(({ kind, file, line }) => [kind, file, line]), [
    ["definition", "layout.ts", 1], ["calls", "page.tsx", 2], ["possible", "dispatch.ts", 2],
    ["imports", "page.tsx", 1], ["imports", "registry.ts", 1], ["indirect", "layout.test.ts", 2],
  ]);
  assert.equal(first.rows.find(({ kind }) => kind === "indirect").text, "assert.deepEqual(render(), []);");
  const cached = queryCodeGraph(root, Object.keys(sources), { ...query, kind: "callers" });
  assert.equal(cached.snapshot, first.snapshot);
  assert.equal(cached.cacheHit, true);
  assert.ok(!cached.rows.some(({ kind }) => kind === "imports" || kind === "indirect"));
  fs.writeFileSync(path.join(root, "page.tsx"), sources["page.tsx"].replace("arrange([])", "[]"));
  const refreshed = queryCodeGraph(root, Object.keys(sources), query);
  assert.notEqual(refreshed.snapshot, first.snapshot);
  assert.ok(!refreshed.rows.some(({ kind }) => kind === "calls" || kind === "indirect"));
});

test("graph queries reject traversal, absolute files and free-form input", () => {
  assert.deepEqual(codeGraphQuery({ symbol: "applyLayout", kind: "impact", file: "src\\layout.ts", line: 2 }),
    { symbol: "applyLayout", kind: "impact", file: "src/layout.ts", line: 2 });
  for (const file of ["../layout.ts", "C:\\repo\\layout.ts", "/src/layout.ts"]) {
    assert.equal(codeGraphQuery({ symbol: "applyLayout", kind: "callers", file }), undefined);
  }
  assert.equal(codeGraphQuery({ symbol: "applyLayout()", kind: "callers" }).symbol, "applyLayout");
  assert.equal(codeGraphQuery({ symbol: "applyLayout(input)", kind: "callers" }), undefined);
});

test("the assignment graph groups dependent shortlist files and reports imports across its boundary", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-assignment-graph-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = {
    "main.ts": "import './helpers'; import './shared';",
    "helpers.ts": "export const helper = 1;",
    "docs.cjs": "const shared = require('./shared');",
    "shared.ts": "export const setting = 2;",
  };
  for (const [file, content] of Object.entries(sources)) fs.writeFileSync(path.join(root, file), content);
  const graph = assignmentGraph(root, Object.keys(sources), "Check main.ts, helpers.ts and docs.cjs.");
  assert.deepEqual(graph.groups, [["helpers.ts", "main.ts"], ["docs.cjs"]]);
  assert.ok(graph.links.includes("main.ts → shared.ts"));
  assert.ok(graph.links.includes("docs.cjs → shared.ts"));
  assert.equal(assignmentGraph(root, Object.keys(sources), "Unrelated task"), null);
});
