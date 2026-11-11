const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { isMainThread, parentPort } = require("node:worker_threads");
const ts = require("typescript");

const maxFiles = 1600;
const maxFileBytes = 256 * 1024;
const maxBytes = 12 * 1024 * 1024;
const maxRows = 20;
const options = { allowJs: true, noLib: true, types: [], target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalize = (file) => file.replaceAll("\\", "/");
let cache;

function collect(root, candidates) {
  const files = new Map();
  let bytes = 0;
  let skipped = 0;
  for (const file of candidates) {
    if (files.size >= maxFiles || bytes >= maxBytes) { skipped++; continue; }
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (!relative || path.isAbsolute(relative) || relative.startsWith(".." + path.sep)) { skipped++; continue; }
    try {
      const real = fs.realpathSync(absolute);
      if (path.relative(absolute, real)) { skipped++; continue; }
      const stat = fs.statSync(real);
      if (!stat.isFile() || stat.size > maxFileBytes || bytes + stat.size > maxBytes) { skipped++; continue; }
      const input = fs.readFileSync(real);
      const after = fs.statSync(real);
      if (path.relative(real, fs.realpathSync(absolute)) || stat.mtimeMs !== after.mtimeMs || stat.size !== after.size ||
          input.length > maxFileBytes || bytes + input.length > maxBytes || input.includes(0)) { skipped++; continue; }
      const digest = hash(input);
      const name = normalize(absolute);
      const old = cache?.root === root && cache.files.get(name);
      const entry = old?.digest === digest ? old : { digest, text: input.toString("utf8") };
      files.set(name, entry);
      bytes += input.length;
    } catch { skipped++; }
  }
  return { files, skipped };
}

function makeProgram(files, root, oldProgram) {
  const dirs = new Set();
  const cwd = normalize(root);
  for (const file of files.keys()) {
    let dir = path.posix.dirname(file);
    while (!dirs.has(dir)) {
      dirs.add(dir);
      const parent = path.posix.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const readFile = (name) => files.get(normalize(name))?.text;
  const host = {
    getSourceFile(name, target) {
      const file = files.get(normalize(name));
      if (file) return file.ast ??= ts.createSourceFile(name, file.text, target, true);
    },
    getDefaultLibFileName: () => "",
    getCurrentDirectory: () => cwd,
    getCanonicalFileName: normalize,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    readFile,
    fileExists: (name) => files.has(normalize(name)),
    directoryExists: (name) => dirs.has(normalize(name)),
    writeFile() {},
  };
  return ts.createProgram({ rootNames: [...files.keys()], options, host, oldProgram });
}

function declarationName(node) {
  if ((ts.isFunctionDeclaration(node) && node.body) || ts.isMethodDeclaration(node)) return node.name;
  if (ts.isVariableDeclaration(node) && node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return node.name;
}

function buildIndex(program, root) {
  const checker = program.getTypeChecker();
  const definitions = new Map();
  const symbols = new Map();
  const inbound = new Map();
  const resolve = (symbol) => symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
  const getSymbol = (name) => resolve(checker.getSymbolAtLocation(name));
  function location(node, kind) {
    const source = node.getSourceFile();
    const start = node.getStart(source);
    const { line } = source.getLineAndCharacterOfPosition(start);
    const lineStart = source.getPositionOfLineAndCharacter(line, 0);
    const from = Math.max(lineStart, start - 120);
    return { kind, file: normalize(path.relative(root, source.fileName)), line: line + 1,
      text: source.text.slice(from, from + 220).split(/\r?\n/u)[0].trim() };
  }
  function add(symbol, site, owner) {
    const target = symbols.get(symbol);
    if (!target) return;
    if (!inbound.has(target)) inbound.set(target, []);
    inbound.get(target).push({ ...site, owner });
  }
  for (const source of program.getSourceFiles()) {
    function visit(node) {
      const name = declarationName(node);
      if (name && ts.isIdentifier(name)) {
        const symbol = getSymbol(name);
        if (symbol) {
          const definition = { ...location(node, "definition"), name: name.text };
          if (!definitions.has(name.text)) definitions.set(name.text, []);
          definitions.get(name.text).push(definition);
          symbols.set(symbol, definition);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const source of program.getSourceFiles()) {
    function visit(node, owner) {
      const name = declarationName(node);
      if (name) owner = symbols.get(getSymbol(name)) ?? owner;
      if (ts.isImportSpecifier(node) || ts.isImportClause(node) && node.name) {
        add(getSymbol(node.name), location(node, "imports"), owner);
      } else if (ts.isCallExpression(node)) {
        const expr = node.expression;
        if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) {
          const name = ts.isIdentifier(expr) ? expr : expr.name;
          const symbol = getSymbol(name);
          const virtual = symbol?.declarations?.some(ts.isMethodDeclaration);
          add(symbol, location(node, virtual ? "possible" : "calls"), owner);
        } else if (ts.isElementAccessExpression(expr)) {
          const container = getSymbol(expr.expression);
          const value = container?.valueDeclaration?.initializer;
          if (value && ts.isObjectLiteralExpression(value)) {
            for (const property of value.properties.slice(0, 48)) {
              const symbol = ts.isShorthandPropertyAssignment(property)
                ? resolve(checker.getShorthandAssignmentValueSymbol(property))
                : ts.isPropertyAssignment(property) && getSymbol(property.initializer);
              add(symbol, location(node, "possible"), owner);
            }
          }
        }
      }
      ts.forEachChild(node, (child) => visit(child, owner));
    }
    visit(source);
  }
  return { definitions, inbound };
}

function queryCodeGraph(cwd, candidates, query) {
  const started = performance.now();
  const root = fs.realpathSync(cwd);
  const { files, skipped } = collect(root, candidates);
  const snapshot = hash(JSON.stringify([...files].map(([file, entry]) => [normalize(path.relative(root, file)), entry.digest]).sort()));
  const reused = cache?.root === root && cache.snapshot === snapshot;
  if (!reused) {
    const program = makeProgram(files, root, cache?.root === root ? cache.program : undefined);
    cache = { root, files, snapshot, program, ...buildIndex(program, root) };
  }
  const matches = (cache.definitions.get(query.symbol) ?? []).filter(({ file }) => !query.file || file === query.file);
  const definitions = query.line && matches.length > 1 ? matches.filter(({ line }) => line === query.line) : matches;
  const rows = definitions.slice(0, maxRows);
  if (definitions.length === 1) {
    const visited = new Set(definitions);
    let layer = definitions;
    for (let depth = 1; layer.length && depth <= (query.kind === "impact" ? 2 : 1); depth++) {
      const next = [];
      for (const target of layer) {
        for (const { owner, ...site } of cache.inbound.get(target) ?? []) {
          if (query.kind === "callers" && site.kind === "imports") continue;
          if (depth > 1 && site.kind !== "calls") continue;
          rows.push(depth > 1 ? { ...site, kind: "indirect" } : site);
          if (site.kind === "calls" && owner && !visited.has(owner)) {
            visited.add(owner);
            next.push(owner);
          }
        }
      }
      layer = next.slice(0, 24);
    }
  }
  const order = ["definition", "calls", "possible", "imports", "indirect"];
  const unique = [...new Map(rows.map((row) => [JSON.stringify(row), row])).values()];
  unique.sort((left, right) => order.indexOf(left.kind) - order.indexOf(right.kind) ||
    left.file.localeCompare(right.file) || left.line - right.line);
  return { query, rows: unique.slice(0, maxRows), snapshot, indexedFiles: files.size, skipped,
    partial: skipped > 0 || unique.length > maxRows, ambiguous: definitions.length > 1,
    elapsedMs: Math.round(performance.now() - started), cacheHit: Boolean(reused) };
}

function assignmentGraph(cwd, candidates, text) {
  const tokens = new Set((text.replaceAll("\\", "/").match(/[\p{L}\p{N}_.$/-]+/gu) ?? [])
    .map((token) => token.replace(/^\.\//u, "").replace(/\.+$/u, "")));
  const basenames = new Map();
  for (const file of candidates) {
    const name = path.posix.basename(file);
    basenames.set(name, basenames.has(name) ? null : file);
  }
  const named = candidates.filter((file) => tokens.has(file) || basenames.get(path.posix.basename(file)) === file && tokens.has(path.posix.basename(file)));
  if (!named.length) return null;
  const root = fs.realpathSync(cwd);
  const { files, skipped } = collect(root, [...new Set([...named, ...candidates])]);
  const focus = new Set(named.slice(0, 24).filter((file) => files.has(normalize(path.join(root, file)))));
  if (!focus.size) return null;
  const host = { fileExists: (file) => files.has(normalize(file)), readFile: (file) => files.get(normalize(file))?.text };
  const resolution = ts.createModuleResolutionCache(normalize(root), normalize, options);
  const neighbors = new Map([...focus].map((file) => [file, new Set()]));
  const links = new Set();
  for (const [file, entry] of files) {
    const from = normalize(path.relative(root, file));
    for (const { fileName } of ts.preProcessFile(entry.text, true, true).importedFiles) {
      if (!fileName.startsWith(".")) continue;
      const resolved = ts.resolveModuleName(fileName, file, options, host, resolution).resolvedModule;
      if (!resolved) continue;
      const to = normalize(path.relative(root, resolved.resolvedFileName));
      if (to === from || !focus.has(from) && !focus.has(to)) continue;
      links.add(from + " → " + to);
      if (focus.has(from) && focus.has(to)) {
        neighbors.get(from).add(to);
        neighbors.get(to).add(from);
      }
    }
  }
  const groups = [];
  const visited = new Set();
  for (const file of focus) {
    if (visited.has(file)) continue;
    const group = [file];
    visited.add(file);
    for (const member of group) {
      for (const neighbor of neighbors.get(member)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        group.push(neighbor);
      }
    }
    groups.push(group.sort());
  }
  return { groups, links: [...links].slice(0, 14), indexedFiles: files.size, focusFiles: focus.size,
    partial: skipped > 0 || named.length !== focus.size || links.size > 14 };
}

if (!isMainThread) parentPort.on("message", ({ cwd, files, query }) => {
  try { parentPort.postMessage({ result: query.assignmentText === undefined
    ? queryCodeGraph(cwd, files, query) : assignmentGraph(cwd, files, query.assignmentText) }); }
  catch (error) { parentPort.postMessage({ error: error.message }); }
});

module.exports = { queryCodeGraph, assignmentGraph };
