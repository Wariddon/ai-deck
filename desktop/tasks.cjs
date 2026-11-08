const { randomUUID } = require("node:crypto");
const { unresolvedTeamPlan } = require("./collaboration.mjs");
const { continuationFor } = require("./usage-routing.mjs");

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
  if (!workspace.tasks.some((task) => task.id === workspace.currentTask)) workspace.currentTask = workspace.tasks[0].id;
  return workspace;
}

function selectedTask(workspace) {
  return workspace.tasks.find((task) => task.id === workspace.currentTask);
}

function taskSummary(task) {
  return { id: task.id, title: task.title, openedAt: task.openedAt, runs: task.runHistory.length, queued: task.queue.length };
}

function workspaceView(workspace) {
  if (!workspace) return null;
  const { tasks, ...settings } = workspace;
  const task = selectedTask(workspace);
  return { ...settings, ...task, taskId: task.id, tasks: tasks.map(taskSummary) };
}

function canDrain(run, stopped, paused) {
  if (stopped || paused) return false;
  const statuses = Object.values(run.agents).map((agent) => agent.status);
  return statuses.includes("completed") && statuses.every((status) => status === "completed" || status === "skipped");
}

function teamInbox(workspaces) {
  const rows = [];
  for (const workspace of Object.values(workspaces)) {
    for (const task of workspace.tasks) {
      const latest = task.runHistory.at(-1);
      const summary = { repo: workspace.repo, taskId: task.id, title: task.title };
      const addRun = (kind, run, detail) => rows.push({
        ...summary, id: kind + ":" + run.id, kind, runId: run.id, prompt: run.prompt?.slice(0, 180), updatedAt: run.finishedAt, ...detail,
      });
      for (const run of task.runHistory) {
        const plan = run.teamPlan;
        if (run.finishedAt && unresolvedTeamPlan(run) && plan.applyStatus !== "running") {
          addRun("approval", run, { from: plan.from, to: plan.to, applyStatus: plan.applyStatus,
            unavailable: workspace.readOnly ? "Project is read-only" : plan.worktree !== task.worktree ||
              (plan.base && plan.base !== task.base) ? "Original worktree unavailable" : undefined });
        }
      }
      if (latest?.finishedAt && latest.teamPlan && latest.teamPlan.state !== "ready") {
        addRun("plan-input", latest, { from: latest.teamPlan.from, planState: latest.teamPlan.state });
      }
      const pendingReview = task.runHistory.findLast((run) => run.finishedAt && run.reviewPending);
      if (pendingReview) addRun("review", pendingReview, { to: pendingReview.pendingReviewer ?? "claude" });
      const handoff = latest && continuationFor({ ...task, readOnly: workspace.readOnly }, latest.id);
      if (handoff?.kind === "usage-handoff") addRun("usage", latest, { from: handoff.from, to: handoff.agent });
      if (task.queuePaused && task.queue.length) rows.push({
        ...summary, id: "queue:" + task.id, kind: "queue", count: task.queue.length,
        updatedAt: task.queue[0].queuedAt ?? latest?.finishedAt ?? task.openedAt,
      });
    }
  }
  return rows.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

module.exports = { newTask, taskTitle, ensureTasks, selectedTask, taskSummary, workspaceView, canDrain, teamInbox };
