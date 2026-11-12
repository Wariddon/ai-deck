import { execFileSync } from "node:child_process";
import { closeSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const prefix = "ai-deck-windows-";
const stageName = /^ai-deck-windows-[a-z0-9]{6}(?:\.retired)?$/i;
const markerName = ".ai-deck-package.json";
const graceMs = 30 * 60 * 1000;
const retainedVersionCount = 3;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;

function compareVersions(left, right) {
  const a = left.match(versionPattern);
  const b = right.match(versionPattern);
  for (let index = 1; index <= 3; index++) {
    if (BigInt(a[index]) !== BigInt(b[index])) return BigInt(a[index]) > BigInt(b[index]) ? 1 : -1;
  }
  if (a[4] === b[4]) return left.localeCompare(right);
  if (!a[4]) return 1;
  if (!b[4]) return -1;
  const aParts = a[4].split(".");
  const bParts = b[4].split(".");
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index++) {
    if (index >= aParts.length) return -1;
    if (index >= bParts.length) return 1;
    const x = aParts[index];
    const y = bParts[index];
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      if (BigInt(x) !== BigInt(y)) return BigInt(x) > BigInt(y) ? 1 : -1;
      return x.localeCompare(y);
    }
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function assertUnlinkedTree(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (lstatSync(target).isSymbolicLink() || realpathSync.native(target) !== target) {
      throw new Error(`Unexpected linked package content: ${target}`);
    }
    if (entry.isDirectory()) assertUnlinkedTree(target);
  }
}

function assertStagePath(parent, directory) {
  if (path.dirname(directory) !== parent || !stageName.test(path.basename(directory)) ||
      !lstatSync(directory).isDirectory() || realpathSync.native(directory) !== directory) {
    throw new Error(`Unexpected package directory: ${directory}`);
  }
}

function removeStage(parent, directory) {
  assertStagePath(parent, directory);
  assertUnlinkedTree(directory);
  // Leave the ownership record until the payload is gone so a locked file can be retried.
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === markerName) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && realpathSync.native(target) !== target) {
      throw new Error(`Unexpected linked package content: ${target}`);
    }
    rmSync(target, { recursive: entry.isDirectory(), force: true, maxRetries: 2, retryDelay: 100 });
  }
  rmSync(path.join(directory, markerName), { force: true });
  rmdirSync(directory);
}

function readStages(parent, checkout) {
  const stages = [];
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !stageName.test(entry.name)) continue;
    const directory = path.join(parent, entry.name);
    try {
      assertStagePath(parent, directory);
      const marker = path.join(directory, markerName);
      if (!lstatSync(marker).isFile()) continue;
      const record = JSON.parse(readFileSync(marker, "utf8"));
      if (record.checkout === checkout && Number.isInteger(record.pid) && record.pid > 0 &&
          Number.isFinite(record.startedAt) && (record.finishedAt === null || Number.isFinite(record.finishedAt)) &&
          typeof record.keep === "boolean") {
        const manifest = path.join(directory, "AI Deck", "resources", "app", "package.json");
        let version = entry.name.endsWith(".retired") && typeof record.version === "string" &&
          versionPattern.test(record.version) ? record.version : null;
        if (existsSync(manifest) && realpathSync.native(manifest) === manifest && lstatSync(manifest).isFile()) {
          const packagedVersion = JSON.parse(readFileSync(manifest, "utf8")).version;
          if (typeof packagedVersion === "string" && versionPattern.test(packagedVersion) &&
              (!record.version || record.version === packagedVersion)) version = packagedVersion;
        }
        stages.push({ ...record, version, directory, name: entry.name });
      }
    } catch {
      // Legacy, incomplete or unreadable metadata gives no ownership evidence.
    }
  }
  return stages;
}

function runningStages() {
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "$processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)",
    "$names = @(foreach ($p in $processes) {",
    "  [regex]::Matches(($p.ExecutablePath + ' ' + $p.CommandLine), '(?i)ai-deck-windows-[a-z0-9]{6}(?![a-z0-9])') | ForEach-Object Value",
    "})",
    "$owners = @($processes | ForEach-Object { @{ pid = $_.ProcessId; startedAt = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } })",
    "ConvertTo-Json -Compress -Depth 4 -InputObject @{ owners = $owners; stages = $names }",
  ].join("\n");
  const activity = JSON.parse(execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true, timeout: 10000,
  }));
  return { owners: new Map(activity.owners.map((owner) => [owner.pid, owner.startedAt])),
    names: new Set(activity.stages.map((name) => name.toLowerCase())) };
}

function withPackageLock(parent, action) {
  const lock = path.join(parent, ".ai-deck-package.lock");
  const token = randomUUID();
  const deadline = Date.now() + 30000;
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lock, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const identity = lstatSync(lock);
        if (identity.isFile() && !identity.isSymbolicLink()) {
          let owner = null;
          try { owner = JSON.parse(readFileSync(lock, "utf8")); } catch { /* Interrupted lock initialization. */ }
          if (Number.isInteger(owner?.pid) && owner.pid > 0 && typeof owner.token === "string") {
            try { process.kill(owner.pid, 0); } catch (probe) {
              if (probe.code === "ESRCH") {
                if (JSON.parse(readFileSync(lock, "utf8")).token === owner.token) unlinkSync(lock);
              }
            }
          } else if (Date.now() - identity.mtimeMs >= graceMs) {
            const latest = lstatSync(lock);
            if (latest.ino === identity.ino && latest.mtimeMs === identity.mtimeMs && latest.size === identity.size) unlinkSync(lock);
          }
        }
      } catch {
        // Another publisher may be initializing or releasing this lock.
      }
      if (Date.now() >= deadline) throw new Error("Another AI Deck package publication is still running.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }));
    return action();
  } finally {
    closeSync(descriptor);
    if (JSON.parse(readFileSync(lock, "utf8")).token === token) unlinkSync(lock);
  }
}

function prunePackages(checkout, current, inspectActivity) {
  const parent = path.dirname(checkout);
  const outputs = path.resolve(checkout, "../../outputs");
  if (!existsSync(outputs)) return;
  if (realpathSync.native(outputs) !== outputs || !lstatSync(outputs).isDirectory()) {
    throw new Error(`Unexpected package output directory: ${outputs}`);
  }
  const archives = readdirSync(outputs, { withFileTypes: true }).flatMap((entry) => {
    const match = entry.name.match(/^AI Deck (.+) Windows x64\.zip$/);
    if (!entry.isFile() || !match || !versionPattern.test(match[1])) return [];
    const filename = path.join(outputs, entry.name);
    if (realpathSync.native(filename) !== filename) return [];
    return [{ filename, version: match[1], identity: lstatSync(filename) }];
  });
  const stages = readStages(parent, checkout);
  const retained = new Set([...new Set(archives.map((archive) => archive.version))]
    .sort((a, b) => compareVersions(b, a)).slice(0, retainedVersionCount));
  if (!retained.size) return;
  const active = inspectActivity();
  const activeStages = new Set(stages.filter((stage) => {
    const startedAt = active.owners.get(stage.pid);
    return stage.directory === current || active.names.has(stage.name.replace(/\.retired$/i, "").toLowerCase()) ||
      (Number.isFinite(startedAt) && startedAt <= stage.startedAt);
  }).map((stage) => stage.directory));
  const protectedVersions = new Set(stages.filter((stage) => activeStages.has(stage.directory) && stage.version)
    .map((stage) => stage.version));
  const newest = new Set();
  const seenVersions = new Set();
  for (const stage of stages.filter((stage) => stage.finishedAt !== null && retained.has(stage.version) &&
    !stage.name.endsWith(".retired")).sort((a, b) => b.finishedAt - a.finishedAt || a.name.localeCompare(b.name))) {
    if (!seenVersions.has(stage.version)) {
      seenVersions.add(stage.version);
      newest.add(stage.directory);
    }
  }
  const now = Date.now();
  const expired = stages.filter((stage) => !activeStages.has(stage.directory) && !newest.has(stage.directory) &&
    (stage.finishedAt === null ? now - stage.startedAt >= graceMs :
      stage.version !== null || stage.name.endsWith(".retired")));
  for (const stage of expired) {
    try {
      let directory = stage.directory;
      assertStagePath(parent, directory);
      if (!directory.endsWith(".retired")) {
        const retired = directory + ".retired";
        renameSync(directory, retired);
        directory = retired;
      }
      removeStage(parent, directory);
    } catch (error) {
      if (error.code !== "ENOENT") console.warn(`Could not remove old AI Deck stage ${stage.name}: ${error.message}`);
    }
  }
  for (const archive of archives) {
    if (retained.has(archive.version) || protectedVersions.has(archive.version)) continue;
    try {
      const latest = lstatSync(archive.filename);
      if (!latest.isFile() || latest.isSymbolicLink() || latest.ino !== archive.identity.ino ||
          latest.size !== archive.identity.size || latest.mtimeMs !== archive.identity.mtimeMs ||
          realpathSync.native(archive.filename) !== archive.filename) continue;
      unlinkSync(archive.filename);
    } catch (error) {
      if (error.code !== "ENOENT") console.warn(`Could not remove old AI Deck archive: ${error.message}`);
    }
  }
}

export function pruneWindowsPackages(root, inspectActivity = runningStages) {
  const checkout = realpathSync.native(root);
  return withPackageLock(path.dirname(checkout), () => prunePackages(checkout, null, inspectActivity));
}

export function createWindowsStage(root, keep = false) {
  const checkout = realpathSync.native(root);
  const { version } = JSON.parse(readFileSync(path.join(checkout, "desktop", "package.json"), "utf8"));
  if (typeof version !== "string" || !versionPattern.test(version)) throw new Error("Invalid Windows package version.");
  const parent = path.dirname(checkout);
  const scratch = mkdtempSync(path.join(parent, prefix));
  const marker = path.join(scratch, markerName);
  const record = { checkout, keep, version, pid: process.pid, startedAt: Date.now(), finishedAt: null };
  let finished = false;
  process.once("exit", () => {
    if (finished) return;
    try {
      removeStage(parent, scratch);
    } catch (error) {
      if (error.code !== "ENOENT") console.warn(`Could not remove failed AI Deck stage: ${error.message}`);
    }
  });
  writeFileSync(marker, JSON.stringify(record), { flag: "wx" });
  return {
    scratch,
    finish(archive) {
      const archiveName = `AI Deck ${version} Windows x64.zip`;
      if (archive !== path.join(scratch, archiveName) || !lstatSync(archive).isFile() ||
          realpathSync.native(archive) !== archive) throw new Error("Unexpected Windows package archive.");
      return withPackageLock(parent, () => {
        const outputs = path.resolve(checkout, "../../outputs");
        mkdirSync(outputs, { recursive: true });
        if (realpathSync.native(outputs) !== outputs) throw new Error("Linked Windows package output directory.");
        const deliverable = path.join(outputs, archiveName);
        try {
          renameSync(archive, deliverable);
        } catch (error) {
          if (error.code !== "EXDEV") throw error;
          const temporary = path.join(outputs, `.${path.basename(scratch)}.zip.tmp`);
          closeSync(openSync(temporary, "wx"));
          try {
            cpSync(archive, temporary);
            renameSync(temporary, deliverable);
            unlinkSync(archive);
          } finally {
            rmSync(temporary, { force: true });
          }
        }
        finished = true;
        try {
          writeFileSync(marker, JSON.stringify({ ...record, finishedAt: Date.now() }));
          prunePackages(checkout, scratch, runningStages);
        } catch (error) {
          console.warn(`Could not clean AI Deck packages: ${error.message}`);
        }
        return deliverable;
      });
    },
  };
}
