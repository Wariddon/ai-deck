const fs = require("node:fs");
const path = require("node:path");

const taskIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

function atomicJson(filename, data) {
  const temp = filename + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data));
  fs.renameSync(temp, filename);
}

function readCheckpoint(filename) {
  try { return JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch { return null; }
}

function writeDraft(profile, taskId, entry) {
  if (!taskIdPattern.test(taskId)) throw new Error("The task has no valid local draft ID.");
  const directory = path.join(profile, "draft-checkpoints");
  fs.mkdirSync(directory, { recursive: true });
  atomicJson(path.join(directory, taskId + ".json"), entry);
}

function clearDraft(profile, taskId) {
  if (taskIdPattern.test(taskId)) fs.rmSync(path.join(profile, "draft-checkpoints", taskId + ".json"), { force: true });
}

function restoreCheckpoints(profile, workspaces) {
  const tasks = new Map(Object.values(workspaces).flatMap(({ tasks }) => tasks.map((task) => [task.id, task])));
  const run = readCheckpoint(path.join(profile, "running-checkpoint.json"));
  if (run?.id && run.agents && Number.isSafeInteger(run.checkpointSeq)) {
    for (const task of tasks.values()) {
      const index = task.runHistory?.findIndex((entry) => entry.id === run.id && !entry.finishedAt) ?? -1;
      if (index < 0) continue;
      if (run.checkpointSeq > (task.runHistory[index].checkpointSeq ?? 0)) task.runHistory[index] = run;
      break;
    }
  }
  const directory = path.join(profile, "draft-checkpoints");
  let files;
  try { files = fs.readdirSync(directory); } catch { return; }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -5);
    const task = taskIdPattern.test(id) && tasks.get(id);
    if (!task) continue;
    const draft = readCheckpoint(path.join(directory, file));
    if (typeof draft?.id === "string" && typeof draft.draft?.prompt === "string" && draft.id !== task.recoveryDraft?.consumedId) {
      task.recoveryDraft = draft;
    }
  }
}

function writeRunningCheckpoint(profile, run) {
  const previous = run.checkpointSeq ?? 0;
  run.checkpointSeq = previous + 1;
  try { atomicJson(path.join(profile, "running-checkpoint.json"), run); }
  catch (error) { run.checkpointSeq = previous; throw error; }
}

function clearRunningCheckpoint(profile) {
  fs.rmSync(path.join(profile, "running-checkpoint.json"), { force: true });
}

module.exports = { writeDraft, clearDraft, restoreCheckpoints, writeRunningCheckpoint, clearRunningCheckpoint };