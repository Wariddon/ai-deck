const parsedTime = (value) => Number.isFinite(value) ? value : Date.parse(value) || 0;

export function mergeLinkedPage(current, page, older = false) {
  if (page.error) return page.error === current?.error ? current : { ...current, error: page.error };
  if (!older && !current?.error && page.revision && page.revision === current?.revision && page.active === current.active) return current;
  if (older) {
    const seen = new Set(current?.messages?.map(({ id }) => id));
    return { ...page, loadedOlder: true, messages: [...(current?.messages ?? []), ...page.messages.filter(({ id }) => !seen.has(id))] };
  }
  const overlap = current?.messages?.findIndex(({ id }) => id === page.messages.at(-1)?.id) ?? -1;
  if (overlap === -1 || !current?.loadedOlder) return page;
  return { ...page, cursor: current.cursor, loadedOlder: true,
    messages: [...page.messages, ...current.messages.slice(overlap + 1)] };
}

export function linkedTimelineRows(pages, runs, filter) {
  const rows = [];
  for (const [agent, page] of Object.entries(pages)) {
    if (filter !== "all" && agent !== filter) continue;
    const seen = new Set();
    for (const message of [...(page.messages ?? [])].reverse()) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      rows.push({ key: agent + ":" + message.id, kind: "message", agent, at: parsedTime(message.at), message });
    }
  }
  for (const run of runs) {
    const agent = Object.keys(run.agents)[0];
    if (filter !== "all" && agent !== filter) continue;
    const status = run.agents[agent]?.status;
    if (run.linkedHandoff) rows.push({
      key: run.id + ":handoff", kind: "handoff", agent, at: parsedTime(run.startedAt), receipt: run.linkedHandoff, status, runId: run.id,
    });
    for (const evidence of (run.evidence ?? []).filter((item) => item.kind === "command").slice(-6)) {
      rows.push({ key: run.id + ":" + evidence.agent + ":" + evidence.id, kind: "command", agent: evidence.agent,
        at: parsedTime(evidence.at), evidence, runId: run.id });
    }
    if (run.finishedAt) rows.push({
      key: run.id + ":result", kind: "result", agent, at: parsedTime(run.finishedAt), git: run.linkedGit, status, runId: run.id,
    });
  }
  return rows.sort((left, right) => left.at - right.at);
}

export function groupLinkedCommands(rows) {
  const grouped = [];
  for (const row of rows) {
    if (row.kind !== "command") {
      grouped.push(row);
      continue;
    }
    const previous = grouped.at(-1);
    if (previous?.kind === "commands" && previous.runId === row.runId && previous.agent === row.agent) {
      previous.commands.push(row);
    } else {
      grouped.push({ ...row, kind: "commands", commands: [row] });
    }
  }
  return grouped;
}

export function linkedRecoveryDraft(recovery) {
  const run = recovery.limitedRun;
  if (!run) return "Continue from the most recent verified worktree and conversation.";
  const outcomes = (run.evidence ?? []).filter(({ kind }) => kind === "command").slice(-6).map((item) =>
    item.subject.slice(0, 250) + " · " + item.status + (Number.isInteger(item.exitCode) ? " · exit " + item.exitCode : ""));
  const files = run.linkedGit?.files ?? [];
  const provider = recovery.from === "codex" ? "Codex" : "Claude Code";
  return "Continue the interrupted task after " + provider + " reached its usage limit. Inspect the checkout before repeating any command. " +
    "Treat the prior task and observed results below as context.\n\nPrior task:\n" + run.prompt.slice(0, 10000) +
    (files.length ? "\n\nWorking paths reported after that turn:\n" + files.slice(0, 12).map((file) => "- " + file.slice(0, 180)).join("\n") : "") +
    (outcomes.length ? "\n\nRecorded command outcomes:\n" + outcomes.join("\n") : "");
}

export function linkedNextAction(link, runs) {
  if (link.next) return { ...link.next, saved: true };
  const last = runs.findLast((run) => run.finishedAt);
  const agent = last && Object.keys(last.agents)[0];
  const mode = link.lastMode ?? (link.source.provider === "codex" ? "codex-review" : "claude");
  if (last && ["codex", "claude-write"].includes(last.mode) && last.linkedGit?.changed) {
    return { mode: agent === "codex" ? "claude" : "codex-review",
      text: "Review the current working changes from the latest turn. Check the relevant files and report any remaining issues." };
  }
  if (last && last.agents[agent]?.status !== "completed") {
    return { mode, text: "Continue the previous task. Check the current worktree and the last turn before retrying." };
  }
  return { mode, text: "Continue from the latest saved conversation. Check the current work and propose the next step." };
}
