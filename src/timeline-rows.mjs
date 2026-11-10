const isWorkStep = (row) => row.kind === "activity" && !row.handoff;
const isMessage = (row) => row.kind === "message";
const turnId = (row) => row.id.split(":", 1)[0];
const activeWorkLimit = 320;
const activeMessageLimit = 60;
const completedWorkLimit = 60;

export function conversationTurns(rows, runs) {
  const records = new Map(runs.map((run) => [run.id, run]));
  const turns = [];
  for (const row of rows) {
    const id = turnId(row);
    let turn = turns.at(-1);
    if (turn?.id !== id) {
      turn = { id, run: records.get(id), rows: [], work: [] };
      turns.push(turn);
    }
    if (row.kind === "prompt") turn.prompt = row;
    else if (row.kind === "activity") turn.work.push(row);
    else {
      turn.rows.push(row);
      if (row.kind === "team-result") turn.work.push(...row.work);
    }
  }
  return turns;
}

export function appendLiveRow(rows, row, delta = false) {
  const index = rows.findLastIndex(({ id }) => id === row.id);
  const text = (delta ? (rows[index]?.text ?? "") + row.text : row.text).slice(-30000);
  const next = { ...row, text, ...(rows[index]?.profile && !row.profile && { profile: rows[index].profile }) };
  if (index >= 0) {
    const updated = rows.slice();
    updated[index] = next;
    return updated;
  }
  const matches = isWorkStep(row) ? isWorkStep : isMessage(row) ? isMessage : null;
  if (matches) {
    const limit = matches === isWorkStep ? activeWorkLimit : activeMessageLimit;
    const prefix = turnId(row) + ":";
    let count = 0;
    for (let index = rows.length - 1; index >= 0 && rows[index].id.startsWith(prefix); index--) {
      if (matches(rows[index]) && ++count === limit) return [...rows.slice(0, index), ...rows.slice(index + 1), next];
    }
  }
  return [...rows, next];
}

export function retainTimelineRows(rows, runs) {
  const retained = new Set(runs.map(({ id }) => id));
  const work = new Map();
  const result = [];
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    const id = turnId(row);
    if (!retained.has(id)) continue;
    if (isWorkStep(row)) {
      const count = work.get(id) ?? 0;
      if (count >= completedWorkLimit) continue;
      work.set(id, count + 1);
    }
    result.push(row);
  }
  return result.reverse();
}
