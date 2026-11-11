// Explain saved member outcomes without inferring charges from missing usage.
export function memberWasCalled(record) {
  return Boolean(record && (record.providerCalls > 0 || record.runTokens || record.usage || record.answer || record.messages?.length));
}

export function memberStatusNote(run, id, status = run?.agents?.[id]?.status) {
  const record = run?.agents?.[id];
  if (!record) return "";
  if (record.statusReason) return record.statusReason;
  if (status !== "skipped") return "";
  if (run.reviewSkipped) return run.reviewSkipped;
  const members = run.sessionTeam?.members ?? [];
  const index = members.findIndex((member) => member.id === id);
  const member = members[index];
  const previous = member?.parentId ? members.find((entry) => entry.id === member.parentId)
    : index < 0 || run.sessionTeam?.topology === "tree" ? undefined : members.slice(0, index).findLast((entry) =>
      ["interrupted", "failed", "limited", "skipped"].includes(run.agents[entry.id]?.status));
  const upstream = previous && run.agents[previous.id];
  if (upstream && upstream.status !== "completed" && !memberWasCalled(record)) {
    const outcome = { interrupted: "was interrupted", failed: "failed", limited: "reached its usage limit", skipped: "was skipped" }[upstream.status] ?? "did not finish";
    return `${previous.name || upstream.memberName || "The previous member"} ${outcome} before this member could start.`;
  }
  if (run.recoveredAfterRestart && !memberWasCalled(record)) return "The previous run was interrupted before this member could start.";
  return memberWasCalled(record) ? "This stage was skipped after a provider request." : "This member was not started in this run.";
}

export function memberUsageNote(run, id) {
  const record = run?.agents?.[id];
  if (record?.status === "skipped" && !memberWasCalled(record)) return "No model request was sent for this member.";
  return "No usage reported for this run";
}
