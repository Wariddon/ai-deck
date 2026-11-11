const { randomUUID } = require("node:crypto");
const { unresolvedTeamPlan } = require("./collaboration.mjs");
const { savedEvidenceCheckpoint } = require("./team-criteria.mjs");

const taskFields = ["worktree", "base", "codexThread", "claudeSession", "usage", "runHistory"];
const taskTitle = (prompt) => prompt.trim().replace(/\s+/gu, " ").slice(0, 65) || "New task";

function newTask() {
  return { id: randomUUID(), title: "New task", openedAt: new Date().toISOString(), worktree: null, usage: {}, runHistory: [], queue: [] };
}

function ensureTasks(workspace) {
  if (!Array.isArray(workspace.tasks) || !workspace.tasks.length) {
    const task = newTask();
    for (const field of taskFields) {
      if (Object.hasOwn(workspace, field)) {
        task[field] = workspace[field];
        delete workspace[field];
      }
    }
    task.openedAt = workspace.openedAt || task.openedAt;
    const prompt = task.runHistory[0]?.prompt;
    task.title = prompt ? taskTitle(prompt) : task.worktree ? "Existing workspace" : "New task";
    workspace.tasks = [task];
    workspace.currentTask = task.id;
  }
  for (const task of workspace.tasks) task.queue ??= [];
  if (!workspace.tasks.some((task) => !task.archivedAt)) workspace.tasks.push(newTask());
  if (!workspace.tasks.some((task) => task.id === workspace.currentTask && !task.archivedAt)) {
    workspace.currentTask = workspace.tasks.find((task) => !task.archivedAt).id;
  }
  return workspace;
}

function selectedTask(workspace) {
  return workspace.tasks.find((task) => task.id === workspace.currentTask);
}

function taskSummary(task) {
  const attention = taskAttention(task);
  return { id: task.id, title: task.title, openedAt: task.openedAt, runs: task.runHistory.length, queued: task.queue.length,
    ...(attention && { attention }),
    ...(task.archivedAt && { archived: true }) };
}

function taskAttention(task) {
  if (task.archivedAt) return;
  const runs = task.runHistory;
  const latest = runs.at(-1);
  if (latest && !latest.finishedAt) return;
  if (latest?.teamPlan && latest.teamPlan.state !== "ready" && task.hiddenPlanNoticeId !== latest.id) return { label: "Plan note available", runId: latest.id };
  const plan = runs.findLast((run) => run.finishedAt && unresolvedTeamPlan(run) && run.teamPlan.applyStatus !== "running");
  if (plan) return { label: "Saved plan awaiting a decision", runId: plan.id };
  const review = runs.findLast((run) => run.finishedAt && run.reviewPending);
  if (review) return { label: "Review pending", runId: review.id };
  if (task.queuePaused && task.queue.length) return { label: "Queue paused" };
}

function runView(run) {
  const checkpoint = savedEvidenceCheckpoint(run);
  if (!checkpoint) return run;
  return { ...run, collaboration: { ...run.collaboration,
    reviewCheckpoint: { reviewer: checkpoint.reviewer, sha256: checkpoint.packet.info.sha256, files: checkpoint.packet.info.includedPaths,
      ...(checkpoint.focus && { criterionId: checkpoint.focus.id, ...(checkpoint.focus.kind === "repair" && { kind: "repair" }) }) } } };
}

function workspaceView(workspace) {
  if (!workspace) return null;
  const { tasks, ...settings } = workspace;
  const task = selectedTask(workspace);
  const { linkedUndo, sessionTeamChats, ...publicTask } = task;
  return { ...settings, ...publicTask, runHistory: task.runHistory.map(runView), taskId: task.id,
    canUndoLinkedApply: Boolean(linkedUndo), tasks: tasks.map(taskSummary) };
}

function canDrain(run, stopped, paused) {
  if (stopped || paused) return false;
  const statuses = Object.values(run.agents).map((agent) => agent.status);
  return statuses.includes("completed") && statuses.every((status) => status === "completed" || status === "skipped");
}

function hidePlanNotice(task, runId) {
  const run = task.runHistory.at(-1);
  if (!run?.finishedAt || run.id !== runId || !run.teamPlan || run.teamPlan.state === "ready") {
    throw new Error("This plan note changed. Open this chat again.");
  }
  // Hide the notice only; keep the saved plan, evidence and approval state.
  task.hiddenPlanNoticeId = runId;
}

module.exports = { newTask, taskTitle, ensureTasks, selectedTask, taskSummary, taskAttention, runView, workspaceView, canDrain, hidePlanNotice };
