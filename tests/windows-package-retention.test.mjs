import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createWindowsStage, pruneWindowsPackages } from "../scripts/windows-package-stage.mjs";

const inactive = () => ({ owners: new Map(), names: new Set() });
const archiveName = (version) => `AI Deck ${version} Windows x64.zip`;
const run = promisify(execFile);

function fixture(t) {
  const base = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "ai-deck-retention-")));
  const work = path.join(base, "work");
  const checkout = path.join(work, "ai-deck");
  const outputs = path.join(base, "outputs");
  mkdirSync(path.join(checkout, "desktop"), { recursive: true });
  mkdirSync(outputs);
  writeFileSync(path.join(checkout, "desktop", "package.json"), JSON.stringify({ version: "0.9.12" }));
  const source = path.join(checkout, "source.txt");
  writeFileSync(source, "source and working changes");
  t.after(() => {
    assert.equal(realpathSync.native(base), base);
    assert.equal(path.dirname(base), realpathSync.native(os.tmpdir()));
    assert.equal(lstatSync(base).isSymbolicLink(), false);
    rmSync(base, { recursive: true, force: true });
  });
  let sequence = 0;
  function archive(version) {
    writeFileSync(path.join(outputs, archiveName(version)), `complete archive ${version}`);
  }
  function stage(version, options = {}) {
    const name = `ai-deck-windows-${String(++sequence).padStart(6, "0")}${options.retired ? ".retired" : ""}`;
    const directory = path.join(work, name);
    const app = path.join(directory, "AI Deck", "resources", "app");
    mkdirSync(app, { recursive: true });
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ version }));
    writeFileSync(path.join(app, "main.cjs"), `version ${version}`);
    if (!options.unowned) {
      const record = { checkout, keep: true, pid: 2147483647, startedAt: Date.now() - 3600000,
        finishedAt: Date.now() - 30000 + sequence, ...options.record };
      if (!options.legacy) record.version = version;
      writeFileSync(path.join(directory, ".ai-deck-package.json"), JSON.stringify(record));
    }
    return directory;
  }
  function archives() {
    return readdirSync(outputs).filter((name) => name.endsWith(".zip")).sort();
  }
  function stages() {
    return readdirSync(work).filter((name) => name.startsWith("ai-deck-windows-")).sort();
  }
  return { base, work, checkout, outputs, source, archive, stage, archives, stages };
}

test("retains the three highest release versions and bounds keep-stage and legacy markers", (t) => {
  const f = fixture(t);
  for (const version of ["0.9.8", "0.9.9", "0.9.10", "0.9.11", "0.9.12"]) {
    f.archive(version);
    f.stage(version, { legacy: true });
  }
  writeFileSync(path.join(f.outputs, "handoff.txt"), "work document");
  pruneWindowsPackages(f.checkout, inactive);
  assert.deepEqual(f.archives(), ["0.9.10", "0.9.11", "0.9.12"].map(archiveName));
  assert.equal(f.stages().length, 3);
  assert.equal(readFileSync(f.source, "utf8"), "source and working changes");
  assert.equal(readFileSync(path.join(f.outputs, "handoff.txt"), "utf8"), "work document");
  pruneWindowsPackages(f.checkout, inactive);
  assert.equal(f.stages().length, 3);
});

test("keeps one completed stage per retained version and preserves an unfinished build", (t) => {
  const f = fixture(t);
  for (const version of ["0.9.10", "0.9.11", "0.9.12"]) { f.archive(version); f.stage(version); }
  const newest = f.stage("0.9.12");
  const unfinished = f.stage("0.9.13", { record: { pid: 42, finishedAt: null, startedAt: Date.now() } });
  pruneWindowsPackages(f.checkout, () => ({ owners: new Map([[42, Date.now() - 10000]]), names: new Set() }));
  assert.equal(f.stages().length, 4);
  assert.ok(existsSync(newest));
  assert.ok(existsSync(unfinished));
  assert.equal(f.archives().length, 3);
});

test("protects a running old package and its ZIP, then retries after it exits", (t) => {
  const f = fixture(t);
  for (const version of ["0.9.9", "0.9.10", "0.9.11", "0.9.12"]) f.archive(version);
  const running = f.stage("0.9.9");
  pruneWindowsPackages(f.checkout, () => ({ owners: new Map(), names: new Set([path.basename(running).toLowerCase()]) }));
  assert.ok(existsSync(running));
  assert.equal(f.archives().length, 4);
  pruneWindowsPackages(f.checkout, inactive);
  assert.equal(existsSync(running), false);
  assert.equal(f.archives().length, 3);
});

test("does not confuse a reused PID with the completed package's original process", (t) => {
  const f = fixture(t);
  for (const version of ["0.9.9", "0.9.10", "0.9.11", "0.9.12"]) f.archive(version);
  const old = f.stage("0.9.9", { record: { pid: 42 } });
  pruneWindowsPackages(f.checkout, () => ({ owners: new Map([[42, Date.now()]]), names: new Set() }));
  assert.equal(existsSync(old), false);
});

test("skips unowned legacy directories and removes an owned partial retired stage", (t) => {
  const f = fixture(t);
  for (const version of ["0.9.10", "0.9.11", "0.9.12"]) f.archive(version);
  const unowned = f.stage("0.9.1", { unowned: true });
  const partial = f.stage("0.9.2", { retired: true });
  const app = path.join(partial, "AI Deck");
  assert.equal(realpathSync.native(app), app);
  rmSync(app, { recursive: true });
  pruneWindowsPackages(f.checkout, inactive);
  assert.ok(existsSync(unowned));
  assert.equal(existsSync(partial), false);
});

test("a process-inspection failure leaves the old packages available for retry", (t) => {
  const f = fixture(t);
  for (const version of ["0.9.9", "0.9.10", "0.9.11", "0.9.12"]) { f.archive(version); f.stage(version); }
  assert.throws(() => pruneWindowsPackages(f.checkout, () => { throw new Error("process lookup failed"); }), /process lookup failed/);
  assert.equal(f.archives().length, 4);
  assert.equal(f.stages().length, 4);
  assert.equal(existsSync(path.join(f.work, ".ai-deck-package.lock")), false);
  pruneWindowsPackages(f.checkout, inactive);
  assert.equal(f.archives().length, 3);
});

test("orders prereleases below stable releases using numeric prerelease identifiers", (t) => {
  const f = fixture(t);
  for (const version of ["1.0.0-rc.2", "1.0.0-rc.10", "1.0.0", "1.0.1"]) f.archive(version);
  pruneWindowsPackages(f.checkout, inactive);
  assert.deepEqual(f.archives(), ["1.0.0-rc.10", "1.0.0", "1.0.1"].map(archiveName).sort());
});

test("never follows a junction while cleaning package content", (t) => {
  const f = fixture(t);
  for (const version of ["0.9.9", "0.9.10", "0.9.11", "0.9.12"]) f.archive(version);
  const old = f.stage("0.9.9");
  const outside = path.join(f.base, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "important.txt"), "keep");
  symlinkSync(outside, path.join(old, "AI Deck", "linked"), process.platform === "win32" ? "junction" : "dir");
  pruneWindowsPackages(f.checkout, inactive);
  assert.equal(readFileSync(path.join(outside, "important.txt"), "utf8"), "keep");
  assert.ok(existsSync(old + ".retired"));
});

test("serializes concurrent cleanup and recovers a dead publisher's lock", async (t) => {
  const f = fixture(t);
  for (const version of ["0.9.9", "0.9.10", "0.9.11", "0.9.12"]) { f.archive(version); f.stage(version); }
  writeFileSync(path.join(f.work, ".ai-deck-package.lock"), JSON.stringify({ pid: 2147483647, token: "dead-owner" }));
  const moduleUrl = pathToFileURL(fileURLToPath(new URL("../scripts/windows-package-stage.mjs", import.meta.url))).href;
  const script = `import { pruneWindowsPackages } from ${JSON.stringify(moduleUrl)}; pruneWindowsPackages(process.argv[1], () => ({ owners: new Map(), names: new Set() }));`;
  await Promise.all([1, 2].map(() => run(process.execPath, ["--input-type=module", "-e", script, f.checkout])));
  assert.equal(f.archives().length, 3);
  assert.equal(f.stages().length, 3);
  assert.equal(existsSync(path.join(f.work, ".ai-deck-package.lock")), false);
});

test("a failed publication preserves previous ZIPs", (t) => {
  const f = fixture(t);
  for (const version of ["0.9.8", "0.9.9", "0.9.10", "0.9.11"]) f.archive(version);
  const { scratch, finish } = createWindowsStage(f.checkout, true);
  assert.throws(() => finish(path.join(scratch, archiveName("0.9.12"))), /ENOENT/);
  assert.equal(f.archives().length, 4);
});

test("recovers an old incomplete lock left by an interrupted process", (t) => {
  const f = fixture(t);
  for (const version of ["0.9.9", "0.9.10", "0.9.11", "0.9.12"]) f.archive(version);
  const lock = path.join(f.work, ".ai-deck-package.lock");
  writeFileSync(lock, "");
  const earlier = new Date(Date.now() - 3600000);
  utimesSync(lock, earlier, earlier);
  pruneWindowsPackages(f.checkout, inactive);
  assert.equal(f.archives().length, 3);
  assert.equal(existsSync(lock), false);
});

test("a locked old ZIP is retried after the reader closes it", { skip: process.platform !== "win32" }, async (t) => {
  const f = fixture(t);
  for (const version of ["0.9.9", "0.9.10", "0.9.11", "0.9.12"]) f.archive(version);
  const filename = path.join(f.outputs, archiveName("0.9.9"));
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$handle = [IO.File]::Open($env:AI_DECK_TEST_LOCK_FILE, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)",
    "[Console]::Out.WriteLine('locked')",
    "try { [void][Console]::In.ReadLine() } finally { $handle.Dispose() }",
  ].join("\n");
  const reader = spawn(path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, AI_DECK_TEST_LOCK_FILE: filename }, windowsHide: true,
    });
  const exited = once(reader, "exit");
  let timer;
  try {
    const ready = await Promise.race([
      once(reader.stdout, "data"),
      exited.then(([code]) => { throw new Error(`File reader exited before acquiring the lock: ${code}`); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("File reader timed out")), 10000); }),
    ]);
    assert.match(String(ready[0]), /locked/);
    pruneWindowsPackages(f.checkout, inactive);
    assert.ok(existsSync(filename));
    assert.equal(f.archives().length, 4);
  } finally {
    clearTimeout(timer);
    reader.stdin.end("\n");
    if (reader.exitCode === null) reader.kill();
    await exited;
  }
  pruneWindowsPackages(f.checkout, inactive);
  assert.equal(existsSync(filename), false);
  assert.equal(f.archives().length, 3);
});

test("successful publication invokes retention through the packager's normal finish entry", { skip: process.platform !== "win32" }, (t) => {
  const f = fixture(t);
  for (const version of ["0.9.8", "0.9.9", "0.9.10", "0.9.11"]) { f.archive(version); f.stage(version); }
  const { scratch, finish } = createWindowsStage(f.checkout, true);
  const app = path.join(scratch, "AI Deck", "resources", "app");
  mkdirSync(app, { recursive: true });
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ version: "0.9.12" }));
  const archive = path.join(scratch, archiveName("0.9.12"));
  writeFileSync(archive, "new complete archive");
  const published = finish(archive);
  assert.equal(published, path.join(f.outputs, archiveName("0.9.12")));
  assert.equal(readFileSync(published, "utf8"), "new complete archive");
  assert.deepEqual(f.archives(), ["0.9.10", "0.9.11", "0.9.12"].map(archiveName));
  assert.equal(f.stages().length, 3);
});
