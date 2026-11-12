import { nativeJobKey } from "../desktop/session-selection.mjs";

export function sessionActivity(entry, jobs) {
  const job = entry.provider
    ? jobs.find(job => job.key === nativeJobKey(entry) || job.nativeSessions?.some(ref => ref.provider === entry.provider && ref.id === entry.id))
    : jobs.find(job => job.taskId === entry.id && (!entry.repo || job.repo === entry.repo));
  if (!job) return null;
  if (job.state === "waiting") return { state: "waiting", label: job.reason || "Waiting for a free slot" };
  if (job.needsInput) return { state: "input", label: "Waiting for your input" };
  if (job.state === "preparing") return { state: "working", label: "Preparing" };
  return { state: "working", label: "Thinking or working" };
}
