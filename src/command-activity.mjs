export function commandSummary(command) {
  const line = command.trim().split(/\r?\n/u, 1)[0];
  const shell = /^(?:"[^"\r\n]*[\\/](?:pwsh|powershell)\.exe"|(?:pwsh|powershell)(?:\.exe)?)\s+(?:-\S+\s+)*?-(?:command|c)\s+(.+)$/iu.exec(line);
  let text = (shell?.[1] ?? line).trim();
  if (shell && (text.startsWith("'") && text.endsWith("'") || text.startsWith('"') && text.endsWith('"'))) text = text.slice(1, -1);
  return text.length > 95 ? text.slice(0, 92) + "…" : text;
}

export function groupWorkActivity(rows) {
  const grouped = [];
  for (const row of rows) {
    if (row.kind !== "activity" || row.handoff) {
      grouped.push(row);
      continue;
    }
    const previous = grouped.at(-1);
    if (previous?.kind === "work-activity" && previous.agent === row.agent && previous.runId === row.id.split(":", 1)[0]) {
      previous.steps.push(row);
    } else {
      grouped.push({ ...row, kind: "work-activity", runId: row.id.split(":", 1)[0], steps: [row] });
    }
  }
  return grouped;
}
