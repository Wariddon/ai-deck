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

function writeLiveRow(rows, row, delta) {
  const index = rows.findLastIndex(({ id }) => id === row.id);
  const text = (delta ? (rows[index]?.text ?? "") + row.text : row.text).slice(-30000);
  const next = { ...row, text, ...(rows[index]?.profile && !row.profile && { profile: rows[index].profile }) };
  if (index >= 0) {
    rows[index] = next;
    return;
  }
  const matches = isWorkStep(row) ? isWorkStep : isMessage(row) ? isMessage : null;
  if (matches) {
    const limit = matches === isWorkStep ? activeWorkLimit : activeMessageLimit;
    const prefix = turnId(row) + ":";
    let count = 0;
    for (let index = rows.length - 1; index >= 0 && rows[index].id.startsWith(prefix); index--) {
      if (matches(rows[index]) && ++count === limit) {
        rows.splice(index, 1);
        break;
      }
    }
  }
  rows.push(next);
}

export function appendLiveRow(rows, row, delta = false) {
  const next = rows.slice();
  writeLiveRow(next, row, delta);
  return next;
}

export function appendLiveDeltas(rows, batch) {
  const next = rows.slice();
  for (const row of batch) writeLiveRow(next, row, true);
  return next;
}

export function applyRunUpdate(workspace, { taskId, run, codexThread }) {
  const current = workspace?.runHistory?.at(-1);
  if (!current || workspace.taskId !== taskId || current.id !== run.id || current.finishedAt) return workspace;
  return { ...workspace, codexThread, runHistory: [...workspace.runHistory.slice(0, -1), run] };
}

export function frameDeltas(publish, schedule, cancel) {
  const pending = new Map();
  let frame;
  function discard() {
    if (frame !== undefined) cancel(frame);
    frame = undefined;
    pending.clear();
  }
  function flush() {
    const rows = [...pending.values()];
    discard();
    if (rows.length) publish(rows);
  }
  return { flush, discard, append(row) {
    const previous = pending.get(row.id);
    pending.set(row.id, { ...row, text: ((previous?.text ?? "") + row.text).slice(-30000),
      ...(previous?.profile && !row.profile && { profile: previous.profile }) });
    frame ??= schedule(flush);
  } };
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
