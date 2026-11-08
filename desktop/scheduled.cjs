const { randomUUID } = require("node:crypto");
const { planPair } = require("./collaboration.mjs");

const schedules = new Set(["daily", "weekdays", "weekly"]);
const runners = new Set(["team", "build-review", "claude-plan-codex", "codex-plan-claude", "codex", "claude", "claude-write"]);
const days = [0, 1, 2, 3, 4, 5, 6];
const graceMs = 5 * 60_000;
const waitingStatus = "waiting for usage";
const waitingRun = (schedule) => schedule.runs.find((run) => run.status === waitingStatus);

function nextOccurrence(schedule, after = Date.now()) {
  const [hour, minute] = schedule.time.split(":").map(Number);
  const date = new Date(after);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, hour, minute);
    const day = candidate.getDay();
    if (candidate.getTime() <= after) continue;
    if (schedule.cadence === "weekdays" && (day === 0 || day === 6)) continue;
    if (schedule.cadence === "weekly" && day !== schedule.day) continue;
    return candidate.getTime();
  }
  throw new Error("Could not calculate the next scheduled run.");
}

function scheduleInput(payload, workspaceExists, previous, now = Date.now()) {
  if (previous && waitingRun(previous)) throw new Error("Cancel the waiting run before editing this schedule.");
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!name || name.length > 90 || !prompt || prompt.length > 18000) throw new Error("Enter a name and a task for the schedule.");
  if (!workspaceExists) throw new Error("Select a known project for this schedule.");
  if (!schedules.has(payload.cadence) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(payload.time) || !days.includes(payload.day)) {
    throw new Error("Choose a valid day and local time.");
  }
  if (!runners.has(payload.mode) || !["read", "write"].includes(payload.access) || !["wait", "available"].includes(payload.fallback)) {
    throw new Error("Choose the agents, permissions and usage policy.");
  }
  if (payload.mode === "claude-write" && payload.access !== "write") throw new Error("Claude edits require worktree write access.");
  const next = {
    id: previous?.id ?? randomUUID(), name, prompt, repo: payload.repo, mode: payload.mode,
    cadence: payload.cadence, time: payload.time, day: payload.day, access: planPair(payload.mode) ? "read" : payload.access,
    fallback: planPair(payload.mode) ? "wait" : payload.fallback,
    enabled: previous?.enabled ?? false, runs: previous?.runs ?? [],
  };
  next.nextAt = next.enabled ? nextOccurrence(next, now) : null;
  return next;
}

function claim(schedule, manual, now = Date.now()) {
  if (!manual && !schedule.enabled) return null;
  const waiting = waitingRun(schedule);
  if (waiting) {
    const run = { ...waiting, status: "starting" };
    delete run.detail;
    return {
      ...schedule,
      nextAt: schedule.enabled && schedule.nextAt <= now ? nextOccurrence(schedule, now) : schedule.nextAt,
      runs: schedule.runs.map((entry) => entry === waiting ? run : entry),
    };
  }
  const occurrence = manual ? null : schedule.nextAt;
  if (!manual && (!schedule.enabled || !Number.isFinite(occurrence) || occurrence > now)) return null;
  const run = {
    id: randomUUID(), startedAt: new Date(now).toISOString(), occurrence, status: "starting", mode: schedule.mode,
    repo: schedule.repo,
  };
  return {
    ...schedule,
    nextAt: manual ? schedule.nextAt : nextOccurrence(schedule, now),
    runs: [run, ...schedule.runs].slice(0, 16),
  };
}

function restoreSchedule(schedule, now = Date.now()) {
  const runs = schedule.runs.map((run) => ["starting", "running"].includes(run.status)
    ? { ...run, status: "interrupted", finishedAt: new Date(now).toISOString() } : run);
  // A closed app never replays a missed occurrence after launch.
  const nextAt = schedule.enabled && schedule.nextAt > now ? schedule.nextAt : schedule.enabled ? nextOccurrence(schedule, now) : null;
  return { ...schedule, runs, nextAt };
}

function resultStatus(run) {
  if (run.teamPlan) return { ready: "awaiting approval", "needs-input": "needs input", blocked: "blocked", unclassified: "needs review" }[run.teamPlan.state];
  const values = Object.values(run.agents).map((agent) => agent.status);
  if (values.includes("interrupted")) return "interrupted";
  if (values.includes("completed")) return values.some((value) => !["completed", "skipped"].includes(value)) ? "partial" : "completed";
  return values.includes("limited") && !values.includes("failed") ? "blocked" : "failed";
}

module.exports = { nextOccurrence, scheduleInput, claim, restoreSchedule, resultStatus, graceMs, waitingRun, waitingStatus };
