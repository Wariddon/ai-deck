import { useState } from "react";
import { matchingDecision, smartTextPath, teamContextNotes, teamRunOptions } from "../desktop/team-handoff.mjs";

export function TeamRunOptions({ policy, value, notes, skillIds, prompt, builder, reviewer, decisions, checks, apply, close }) {
  const [options, setOptions] = useState(() => teamRunOptions(policy, value));
  const { context } = options;
  const writers = new Set(teamContextNotes(notes, skillIds, policy, context, "write").map(({ id }) => id));
  const reviewers = new Set(teamContextNotes(notes, skillIds, policy, context, "review").map(({ id }) => id));
  const select = (key, current, id) => setOptions({ ...options, context: { ...context,
    [key]: current.has(id) ? [...current].filter((value) => value !== id) : [...current, id] } });
  const set = (key, value) => setOptions({ ...options, context: { ...context, [key]: value } });
  const smallPath = policy === "smart" && !options.alwaysReview && smartTextPath(prompt);
  return <>
    <p className="dialog-intro">{builder} builds, then {reviewer} reviews. The task and shared project instructions are included.
      Each provider can still read its native instructions and use its enabled tools.</p>
    <div className="team-option-grid">
      <label><input type="checkbox" checked={context.brief} onChange={(event) => set("brief", event.target.checked)} /> Team Brief and roles</label>
      <label><input type="checkbox" checked={context.decisions} onChange={(event) => set("decisions", event.target.checked)} /> Team Decisions ({decisions})</label>
      <label><input type="checkbox" checked={context.history} onChange={(event) => set("history", event.target.checked)} /> Resume provider chats and share the last team outcome</label>
      <label><input type="checkbox" checked={context.diff} onChange={(event) => set("diff", event.target.checked)} /> Send Git diff to reviewer</label>
    </div>
    <p className="setting-detail">{context.history ? "Resumed chats may contain knowledge sent in earlier turns."
      : "Both agents start fresh for this run. Their existing provider chats remain available."}</p>
    {!context.diff && <p className="setting-detail">Review evidence will be marked partial. The reviewer still gets the task and the builder’s summary.</p>}
    <div className="team-context-matrix" role="group" aria-label="Knowledge and skills per agent">
      <strong>Knowledge and skills</strong><strong>{builder}</strong><strong>{reviewer}</strong>
      {notes.map(({ id, name, source, chars }) => <div className="team-context-row" key={id}>
        <span>{name} <small>{source}{Number.isFinite(chars) && " · " + chars.toLocaleString() + " chars"}</small></span>
        <label><input aria-label={name + " for " + builder} type="checkbox" checked={writers.has(id)} onChange={() => select("writerNotes", writers, id)} /></label>
        <label><input aria-label={name + " for " + reviewer} type="checkbox" checked={reviewers.has(id)} onChange={() => select("reviewerNotes", reviewers, id)} /></label>
      </div>)}
      {!notes.length && <span>No shared knowledge or skills in this project yet.</span>}
    </div>
    <div className="team-option-grid">
      <label>Maximum provider turns <select aria-label="Maximum provider turns" value={options.turnLimit}
        onChange={(event) => setOptions({ ...options, turnLimit: Number(event.target.value) })}>
        {[1, 2, 3, 4, 5].map((limit) => <option key={limit}>{limit}</option>)}</select></label>
      <label><input type="checkbox" checked={Boolean(options.askForEvidence)}
        onChange={(event) => setOptions({ ...options, askForEvidence: event.target.checked,
          turnLimit: event.target.checked ? 5 : options.turnLimit })} /> Let the reviewer ask once for missing evidence</label>
      <label><input type="checkbox" checked={options.alwaysReview}
        onChange={(event) => setOptions({ ...options, alwaysReview: event.target.checked })} /> Ask the reviewer even when no files change</label>
      {policy === "smart" && checks > 0 && <label><input type="checkbox" checked={options.runChecks}
        onChange={(event) => setOptions({ ...options, runChecks: event.target.checked })} /> Run {checks} configured checks on an isolated copy before skipping review</label>}
    </div>
    <p className="setting-detail">{smallPath
      ? "Smart can skip review if only " + smallPath + " changes and Git checks pass."
      : options.alwaysReview ? "The reviewer checks the diff or the builder’s report when the turn limit allows it."
        : "The reviewer runs when the builder changes files and the turn limit allows it."}
      {options.turnLimit === 1 && " A review that needs another turn can be resumed explicitly from the saved diff."}</p>
    <p className="setting-detail">The team lead writes the final answer after review when a turn is left. Otherwise, the timeline shows the recorded results together.</p>
    <div className="dialog-actions">
      <button type="button" className="button small" onClick={() => setOptions(teamRunOptions(policy))}>Use mode defaults</button>
      <button type="button" className="button small" onClick={close}>Cancel</button>
      <button type="button" className="button small primary" onClick={() => apply(options)}>Apply to draft</button>
    </div>
  </>;
}

export function TeamDecisions({ data, busy, save, close }) {
  const [entries, setEntries] = useState(() => data.entries);
  const update = (index, change) => setEntries((current) => current.map((entry, position) => position === index ? { ...entry, ...change } : entry));
  return <>
    <p className="dialog-intro">Both agents can receive these decisions. Pinned decisions appear first. Entries from another branch or commit are held until you update them.</p>
    <p className="setting-detail">{data.scope.branch || "Detached checkout"} · {data.scope.base.slice(0, 12)}</p>
    <div className="team-decision-list">
      {entries.map((entry, index) => {
        const stale = entry.id && !entry.refresh && !matchingDecision(entry, data.scope);
        return <section key={entry.id ?? index} className="team-decision">
          <textarea aria-label={"Decision " + (index + 1)} rows={2} maxLength={500} value={entry.text}
            onChange={(event) => update(index, { text: event.target.value })} />
          <div className="thread-actions">
            <label><input type="checkbox" checked={entry.pinned} onChange={(event) => update(index, { pinned: event.target.checked })} /> Pin</label>
            {stale && <><span className="source-pill">Different checkout</span><button type="button" className="button small"
              onClick={() => update(index, { refresh: true })}>Use here</button></>}
            <button type="button" className="button small" onClick={() => setEntries((current) => current.filter((_, position) => position !== index))}>Remove</button>
          </div>
        </section>;
      })}
    </div>
    <div className="dialog-actions">
      <button type="button" className="button small" disabled={busy || entries.length >= 12}
        onClick={() => setEntries([...entries, { text: "", pinned: false }])}>Add decision</button>
      <button type="button" className="button small" onClick={close}>Cancel</button>
      <button type="button" className="button small primary" disabled={busy || entries.some(({ text }) => !text.trim())}
        onClick={() => save({ stamp: data.stamp, entries })}>Save decisions</button>
    </div>
  </>;
}
