import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const prefix = "ai-deck-windows-";
const stageName = /^ai-deck-windows-[a-z0-9]{6}(?:\.retired)?$/i;
const markerName = ".ai-deck-package.json";
const graceMs = 30 * 60 * 1000;

function assertStagePath(parent, directory) {
  if (path.dirname(directory) !== parent || !stageName.test(path.basename(directory)) ||
      !lstatSync(directory).isDirectory() || realpathSync.native(directory) !== directory) {
    throw new Error(`Unexpected package directory: ${directory}`);
  }
}

function removeStage(parent, directory) {
  assertStagePath(parent, directory);
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
        stages.push({ ...record, directory, name: entry.name });
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
    "ConvertTo-Json -Compress -InputObject @{ pids = @($processes.ProcessId); stages = $names }",
  ].join("\n");
  const activity = JSON.parse(execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true, timeout: 10000,
  }));
  return { pids: new Set(activity.pids), names: new Set(activity.stages.map((name) => name.toLowerCase())) };
}

function pruneStages(parent, checkout, current) {
  const stages = readStages(parent, checkout);
  const newest = new Set(stages.filter((stage) => stage.finishedAt !== null && !stage.name.endsWith(".retired"))
    .sort((a, b) => b.finishedAt - a.finishedAt).slice(0, 2).map((stage) => stage.directory));
  const now = Date.now();
  const expired = stages.filter((stage) => !stage.keep && stage.directory !== current &&
    !newest.has(stage.directory) && now - (stage.finishedAt ?? stage.startedAt) >= graceMs);
  if (!expired.length) return;

  const active = runningStages();
  for (const stage of expired) {
    const stageId = stage.name.replace(/\.retired$/i, "").toLowerCase();
    if (active.names.has(stageId) || active.pids.has(stage.pid)) continue;
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
}

export function createWindowsStage(root, keep) {
  const checkout = realpathSync.native(root);
  const parent = path.dirname(checkout);
  const scratch = mkdtempSync(path.join(parent, prefix));
  const marker = path.join(scratch, markerName);
  const record = { checkout, keep, pid: process.pid, startedAt: Date.now(), finishedAt: null };
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
    finish() {
      finished = true;
      try {
        writeFileSync(marker, JSON.stringify({ ...record, finishedAt: Date.now() }));
        pruneStages(parent, checkout, scratch);
      } catch (error) {
        console.warn(`Could not clean AI Deck staging folders: ${error.message}`);
      }
    },
  };
}
