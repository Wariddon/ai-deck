import { useState } from "react";
import { HandoffLocation } from "./NativeRecents.jsx";
import { linkedModeNames } from "./LinkedSessions.jsx";

const stepStates = { todo: "To do", "in-progress": "In progress", done: "Done" };
const short = (value) => value.replace(/\s+/gu, " ").slice(0, 72);

export function LinkedChecklist({ steps, runs, busy, draftOpen, edit, draft, openRun }) {
  return <details className="linked-next-card linked-checklist">
    <summary><strong>Shared checklist</strong> · {steps.filter(({ status }) => status === "done").length}/{steps.length} done</summary>
    {steps.length > 0 && <ol>{steps.map((step) => {
      const run = runs.find(({ id }) => id === step.runId);
      return <li key={step.id}>
        <div><strong>{step.title}</strong><p className="setting-detail">{linkedModeNames[step.mode]} · {stepStates[step.status]}
          {run && " · Turn " + Object.values(run.agents)[0]?.status}</p></div>
        <div className="thread-actions">
          <button className="button small" type="button" disabled={busy || draftOpen || step.status === "done"}
            onClick={() => draft(step)}>Draft step</button>
          {run && <button className="button small" type="button" onClick={() => openRun(run.id)}>Open step evidence</button>}
        </div>
      </li>;
    })}</ol>}
    <button className="button small" type="button" disabled={busy} onClick={edit}>Edit checklist</button>
  </details>;
}

export function EditLinkedChecklist({ steps, runs, mode, busy, save }) {
  const empty = { title: "", mode, status: "todo", runId: "" };
  const [draft, setDraft] = useState(empty);
  const field = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  return <div className="thread-handoff-form">
    <p className="setting-detail">Assign each step, record its status, and link an AI Deck turn as evidence. Mark Done after checking the result.</p>
    <ol className="linked-checklist-editor">{steps.map((step, index) => <li key={step.id}>
      <div><strong>{short(step.title)}</strong><p className="setting-detail">{linkedModeNames[step.mode]} · {stepStates[step.status]}</p></div>
      <div className="thread-actions">
        <button className="button small" type="button" disabled={busy} onClick={() => setDraft({ runId: "", ...step })}>Edit step {index + 1}</button>
        <button className="button small" type="button" disabled={busy || index === 0} aria-label={"Move step " + (index + 1) + " up"}
          onClick={() => save({ action: "move", id: step.id, offset: -1 })}>↑</button>
        <button className="button small" type="button" disabled={busy || index === steps.length - 1} aria-label={"Move step " + (index + 1) + " down"}
          onClick={() => save({ action: "move", id: step.id, offset: 1 })}>↓</button>
      </div>
    </li>)}</ol>
    <form className="thread-handoff-form" onSubmit={async (event) => {
      event.preventDefault();
      if (await save({ action: "save", ...draft })) setDraft(empty);
    }}>
      <label className="field"><strong>Step instructions</strong>
        <textarea rows={3} maxLength={2400} value={draft.title} disabled={busy} onChange={(event) => field("title", event.target.value)} />
      </label>
      <div className="thread-handoff-fields">
        <label className="field"><strong>Assigned agent</strong>
          <select value={draft.mode} disabled={busy} onChange={(event) => field("mode", event.target.value)}>
            {Object.entries(linkedModeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field"><strong>Step status</strong>
          <select value={draft.status} disabled={busy} onChange={(event) => field("status", event.target.value)}>
            {Object.entries(stepStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <label className="field"><strong>Evidence turn</strong>
        <select value={draft.runId} disabled={busy} onChange={(event) => field("runId", event.target.value)}>
          <option value="">Choose later</option>
          {runs.filter(({ finishedAt }) => finishedAt).slice().reverse().map((run) => <option key={run.id} value={run.id}>
            {linkedModeNames[run.mode] ?? run.mode} · {short(run.prompt)}
          </option>)}
        </select>
      </label>
      <div className="thread-actions">
        <button className="button small primary" type="submit" disabled={busy || !draft.title.trim()}>{draft.id ? "Save step" : "Add step"}</button>
        {draft.id && <button className="button small" type="button" disabled={busy} onClick={() => setDraft(empty)}>New step</button>}
        {draft.id && <button className="button small" type="button" disabled={busy} onClick={async () => {
          if (await save({ action: "remove", id: draft.id })) setDraft(empty);
        }}>Remove step</button>}
      </div>
    </form>
  </div>;
}

export function LinkedTransfer({ preview, busy, reload, load, apply }) {
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);
  const [hunks, setHunks] = useState({});
  const [confirmed, setConfirmed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const selectedHunks = (file) => Object.hasOwn(hunks, file) ? hunks[file] : null;
  const selection = files.map((file) => ({ file, hunks: selectedHunks(file) }));
  const valid = result?.patches.length === files.length && files.length > 0 &&
    selection.every((entry) => entry.hunks === null || entry.hunks.length > 0);

  function selectFile(file) {
    setFiles((current) => current.includes(file) ? current.filter((item) => item !== file) : [...current, file]);
    setResult(null);
    setHunks({});
    setConfirmed(false);
  }
  function chooseHunks(file, next) {
    setHunks((current) => ({ ...current, [file]: next }));
    setConfirmed(false);
  }

  return <div className="thread-handoff-form">
    <div className="thread-handoff-fields">
      <HandoffLocation label="From · linked copy" location={preview.source} />
      <HandoffLocation label="To · original branch" location={preview.target} />
    </div>
    <p className="setting-detail">Apply selected text changes to the original working files. Git checks the patch against this checkout and keeps its staging and commit.</p>
    {preview.target.status && <details className="linked-dirty">
      <summary>Existing changes in the destination</summary><pre>{preview.target.status}</pre>
    </details>}
    <div className="thread-actions">
      <button className="button small" type="button" disabled={busy} onClick={reload}>Refresh copy review</button>
      <span className="setting-detail">Copy base · <code>{preview.base.slice(0, 12)}</code></span>
    </div>
    {preview.files.length ? <div className="linked-evidence-picker">
      {preview.files.map(({ file, kind }) => <label key={file} className="thread-handoff-confirm">
        <input type="checkbox" checked={files.includes(file)} disabled={busy || (!files.includes(file) && files.length >= 12)}
          onChange={() => selectFile(file)} />
        <span>{file} <small>{kind === "new" ? "· New file" : "· Changed"}</small></span>
      </label>)}
    </div> : <p className="setting-detail">No eligible changes to apply from this copy.</p>}
    <button className="button small" type="button" disabled={busy || !files.length} onClick={async () => {
      setResult(await load(files));
      setHunks({});
      setConfirmed(false);
    }}>Load selected diffs</button>
    {Object.entries(result?.errors ?? {}).map(([file, error]) => <p className="live-error" key={file} role="alert">{file} · {error}</p>)}
    {result?.patches.map((patch) => <details className="linked-dirty" key={patch.file} open>
      <summary>{patch.file}</summary>
      {patch.wholeOnly ? <p className="setting-detail">Apply this change as a whole file.</p> :
        <label className="field"><strong>Apply scope</strong>
          <select aria-label={"Apply scope for " + patch.file} value={selectedHunks(patch.file) === null ? "whole" : "partial"} disabled={busy}
            onChange={(event) => chooseHunks(patch.file, event.target.value === "whole" ? null : [])}>
            <option value="whole">Whole file</option><option value="partial">Selected hunks</option>
          </select>
        </label>}
      <pre>{patch.header}</pre>
      {patch.hunks.map((hunk) => <div key={hunk.id} className="linked-transfer-hunk">
        {selectedHunks(patch.file) !== null && <label className="thread-handoff-confirm">
          <input type="checkbox" checked={selectedHunks(patch.file).includes(hunk.id)} disabled={busy}
            onChange={() => chooseHunks(patch.file, selectedHunks(patch.file).includes(hunk.id)
              ? selectedHunks(patch.file).filter((id) => id !== hunk.id) : [...selectedHunks(patch.file), hunk.id])} />
          Include {hunk.title}
        </label>}
        <pre>{hunk.text}</pre>
      </div>)}
    </details>)}
    {valid && <label className="thread-handoff-confirm">
      <input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
      I reviewed the selected patch and the original checkout is idle
    </label>}
    <div className="linked-send-footer">
      <span className="setting-detail">{files.length} selected paths</span>
      <button className="button small primary" type="button" disabled={busy || !valid || !confirmed} onClick={() => apply(selection)}>
        Apply to {preview.target.branch}
      </button>
    </div>
  </div>;
}
