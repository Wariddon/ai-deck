import { useState } from "react";
import { agentNames } from "./TeamThread.jsx";

export function WorktreeComparison({ preview, busy, readOnly, combine, refresh }) {
  const [paths, setPaths] = useState({ main: [], claude: [] });
  const count = paths.main.length + paths.claude.length;
  return <>
    <p className="dialog-intro">Select whole files from either worktree. AI Deck tries to apply them on the shared base and opens a new task if they combine cleanly.</p>
    <p className="setting-detail">Base {preview.base.slice(0, 12)} · The new task has unstaged changes. Both original worktrees stay available.</p>
    <div className="deck-comparison">
      {["main", "claude"].map((lane) => {
        const { tracked, files, diff, truncated } = preview[lane];
        const available = [...tracked, ...files];
        return <section key={lane} className="deck-box">
          <h3>{lane === "main" ? "Codex · Main worktree" : "Claude Code · Parallel worktree"}</h3>
          {!available.length && <p className="setting-detail">No changes against the shared base.</p>}
          {available.length > 0 && <>
            <div className="thread-actions">
              <button className="button small" disabled={busy} onClick={() => setPaths((current) => ({ ...current, [lane]: available }))}>Select all</button>
              <button className="button small" disabled={busy} onClick={() => setPaths((current) => ({ ...current, [lane]: [] }))}>Clear selection</button>
            </div>
            <div className="deck-comparison-files">
              {available.map((file) => <label className="setting-row" key={file}>
                <input type="checkbox" checked={paths[lane].includes(file)} disabled={busy} onChange={(event) => {
                  const checked = event.target.checked;
                  setPaths((current) => ({ ...current, [lane]: checked ? [...current[lane], file] : current[lane].filter((name) => name !== file) }));
                }} />
                <span>{file}{files.includes(file) && <small> · New</small>}</span>
              </label>)}
            </div>
          </>}
          {diff && <details>
            <summary>Tracked diff{truncated ? " (preview shortened)" : ""}</summary>
            <pre className="file-preview deck-continuation">{diff}</pre>
          </details>}
        </section>;
      })}
    </div>
    {readOnly && <p className="setting-detail">This project allows comparison only. Enable project edits to create a combined task.</p>}
    <div className="dialog-actions">
      <button className="button small" disabled={busy} onClick={refresh}>Refresh comparison</button>
      <button className="button primary small" disabled={busy || readOnly || !count} onClick={() => combine(paths)}>
        {busy ? "Checking changes…" : "Create combined task" + (count ? " · " + count : "")}
      </button>
    </div>
  </>;
}

export function ReviewTarget({ value, apply }) {
  const [type, setType] = useState(value?.type ?? "");
  const [ref, setRef] = useState(value?.ref ?? "");
  return <form onSubmit={(event) => {
    event.preventDefault();
    apply(type ? { type, ref: ref.trim() } : undefined);
  }}>
    <label className="field"><strong>Compare</strong><select value={type} onChange={(event) => { setType(event.target.value); setRef(""); }}>
      <option value="">Current task changes</option>
      <option value="branch">Worktree against a local branch</option>
      <option value="commit">One commit against its first parent</option>
    </select></label>
    {type && <label className="field"><strong>{type === "branch" ? "Local branch name" : "Commit hash"}</strong>
      <input value={ref} onChange={(event) => setRef(event.target.value)} required maxLength={type === "branch" ? 160 : 64}
        pattern={type === "commit" ? "[a-fA-F0-9]{7,64}" : undefined} />
    </label>}
    <p className="setting-detail">{type === "commit" ? "The reviewer receives that commit's diff." : "The reviewer receives the current worktree diff against the chosen base."}</p>
    <div className="dialog-actions"><button className="button primary small" disabled={Boolean(type) && !ref.trim()}>Use review target</button></div>
  </form>;
}

export function ReviewFiles({ result, value, apply }) {
  const [selected, setSelected] = useState(value ?? []);
  if (!result) return <p>Reading the worktree…</p>;
  return <>
    <p className="dialog-intro">Choose up to six untracked source files to include with the tracked diff. AI Deck checks the selection again before sending it to the reviewer.</p>
    {!result.files.length && <p className="setting-detail">No eligible new source files in the current worktree.</p>}
    {result.truncated && <p className="setting-detail">Showing the first eligible files.</p>}
    {result.files.length > 0 && <div className="setting-list review-file-list">
      {result.files.map((file) => <label className="setting-row" key={file}>
        <input type="checkbox" checked={selected.includes(file)} disabled={selected.length >= 6 && !selected.includes(file)}
          onChange={(event) => setSelected(event.target.checked ? [...selected, file] : selected.filter((item) => item !== file))} />
        <span>{file}</span>
      </label>)}
    </div>}
    <div className="dialog-actions">
      <button className="button small" onClick={() => apply(undefined)}>Use project default</button>
      <button className="button primary small" onClick={() => apply(selected.filter((file) => result.files.includes(file)))}>Use {selected.filter((file) => result.files.includes(file)).length} selected</button>
    </div>
  </>;
}

export function partialReview(snapshot) {
  return Boolean(snapshot?.partial || snapshot?.diffTruncated || snapshot?.omittedNew);
}

export function ReviewEvidence({ snapshot }) {
  if (!snapshot) return null;
  const phase = { "after-build": "after the build", "before-run": "before the run", fallback: "after a usage limit" }[snapshot.phase];
  return <>
    {partialReview(snapshot) && <p className="usage-hold">Review used partial input.</p>}
    <details className="live-context-add">
      <summary>{agentNames[snapshot.reviewer ?? "claude"]} input · {phase}</summary>
      <p className="setting-detail">{snapshot.target?.type === "commit"
        ? "Commit " + snapshot.head?.slice(0, 12)
        : (snapshot.target?.type === "branch" ? snapshot.target.ref + " · " : "") + "Base " + snapshot.base?.slice(0, 8) + " · HEAD " + snapshot.head?.slice(0, 8)}</p>
      <p className="setting-detail">SHA-256 <code className="review-digest">{snapshot.sha256}</code></p>
      {snapshot.changedFiles?.length > 0 && <p className="setting-detail">Incremental review · {snapshot.changedFiles.length} changed files</p>}
      {snapshot.diffTruncated && <p className="setting-detail">The tracked diff exceeded the size limit.</p>}
      {snapshot.binaryOmitted > 0 && <p className="setting-detail">Binary files without contents · {snapshot.binaryOmitted}</p>}
      {snapshot.addedFiles?.length > 0 && <p className="setting-detail">New files sent · {snapshot.addedFiles.join(", ")}</p>}
      {snapshot.omittedNew > 0 && <p className="setting-detail">New files without contents · {snapshot.omittedNew}
        {snapshot.untrackedTruncated ? "+" : ""}{snapshot.omittedFiles?.length ? " · " + snapshot.omittedFiles.join(", ") : ""}</p>}
      {snapshot.unavailableSelected?.length > 0 && <p className="setting-detail">No longer untracked · {snapshot.unavailableSelected.join(", ")}</p>}
    </details>
  </>;
}

export function ReviewFreshness({ review, busy, draftReview }) {
  if (!review) return null;
  const statuses = {
    current: "Current worktree matches the reviewed snapshot.",
    changed: "Changes detected since the last review.",
    partial: "The review covered partial input. Its recorded input still matches.",
    unknown: "This review could not be matched to the current patch.",
    "other-target": "The last review was for a separate commit or branch.",
  };
  return <section className="deck-review-freshness" aria-label="Review freshness">
    <p className={review.status === "changed" ? "usage-hold" : "thread-review-result"}>{statuses[review.status]}</p>
    {review.files?.length > 0 && <p className="setting-detail">{review.files.join(", ")}</p>}
    {review.canReviewChanges && <button className="button small" disabled={busy} onClick={() => draftReview(review)}>Review changed files</button>}
    {review.status === "changed" && !review.canReviewChanges && <p className="setting-detail">Run a full review to capture a new baseline.</p>}
    <ReviewEvidence snapshot={review.snapshot} />
  </section>;
}

export function RunEvidence({ evidence, compact = false }) {
  if (!evidence?.length) return compact ? null : <p className="setting-detail">No command or approval evidence was saved for this run.</p>;
  return <details className="live-context-add deck-run-evidence" open={compact ? undefined : true}>
    <summary>Commands & approvals · {evidence.length}</summary>
    <ul>
      {evidence.map((item, index) => {
        const outcome = item.kind === "approval" ? item.status === "allowed" ? "Allowed once" : "Declined"
          : Number.isInteger(item.exitCode) ? "Exit " + item.exitCode
            : ({ failed: "Reported error", returned: "Output returned", declined: "Declined" }[item.status] ?? "Exit code unavailable");
        return <li key={item.id + ":" + index}>
          <p><strong>{agentNames[item.agent]}</strong> · {item.kind === "approval" ? item.title || "Approval" : "Command"} · {outcome}</p>
          {item.subject && <code>{item.subject}</code>}
          <time className="setting-detail" dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>
        </li>;
      })}
    </ul>
  </details>;
}

export function RunScope({ scope, files }) {
  if (!scope) return <p>Checking run scope…</p>;
  return <>
    <p className="dialog-intro">Applies to the selected mode and current project. AI Deck checks permissions again when it starts the run.</p>
    {scope.blocked && <p className="usage-hold">Project read-only mode blocks this workflow.</p>}
    {scope.lowMemory && scope.route.requested.length > 1 && <p className="setting-detail">Low RAM is on. Only one agent CLI starts at a time.</p>}
    <div className="setting-list">
      <div className="live-note"><strong>Context sent to available agents</strong>
        <p className="setting-detail">{scope.instructions ? "Shared project instructions enabled." : "No shared project instructions."}</p>
        {scope.notes.map((note) => <p className="setting-detail" key={note.id}>{note.source} · {note.name}</p>)}
        {scope.notes.some((note) => note.source === "Skill") && <p className="setting-detail">Imported SKILL.md text is shared as instructions.</p>}
        {scope.teamwork?.brief && <p className="setting-detail">Team brief · {scope.teamwork.brief}</p>}
        {scope.teamwork?.outcome && <p className="setting-detail">Completion / handoff · {scope.teamwork.outcome}</p>}
        {files !== undefined && <p className="setting-detail">New files selected for review · {files.length ? files.join(", ") : "None"}</p>}
      </div>
      {scope.route.requested.map((agent) => <div className="live-note" key={agent}><strong>{agentNames[agent]}</strong>
        {scope.roles?.[agent] && <p className="setting-detail">Workflow role · {scope.roles[agent]}</p>}
        {scope.teamwork?.[agent] && <p className="setting-detail">{scope.teamwork[agent]}</p>}
        {scope.awaitingApproval === agent && <p className="setting-detail">Starts only after you approve the saved plan.</p>}
        {scope.awaitingApproval !== agent && !scope.route.available.includes(agent) && <p className="setting-detail">Unavailable in the selected mode.</p>}
        {scope.awaitingApproval !== agent && scope.route.available.includes(agent) && !scope.blocked && (agent === "codex" ? <>
          <p className="setting-detail">{scope.codexReadOnly ? "Files · Read-only workspace" : "Files · Write inside the task worktree"}</p>
          <p className="setting-detail">Commands · Codex asks for approval when an operation requires it.</p>
        </> : <>
          <p className="setting-detail">Tools · {scope.claudeTools.length ? scope.claudeTools.join(", ") : "Review snapshot only"}</p>
          {scope.roles?.claude === "review" && <p className="setting-detail">File contents come from the review snapshot and shared context.</p>}
          {scope.roles?.claude === "write" && <p className="setting-detail">File edits · Ask each time</p>}
          <p className="setting-detail">Git Bash · {scope.claudeCommands ? "Ask for each foreground command" : "Unavailable for this run"}</p>
        </>)}
        <p className="setting-detail">{scope[agent].length ? "Project MCP tools available" : "No project MCP tools for this mode."}</p>
        {scope[agent].map((plugin) => <p key={plugin.name} className="setting-detail">{plugin.name} · {plugin.tools.join(", ")}</p>)}
        {agent === "codex" && <p className="setting-detail">Native plugins and MCP · {scope.inherit ? "Enabled" : "Disabled for this mode"}
          {scope.native.length ? " · Found " + scope.native.join(", ") : ""}</p>}
        {agent === "codex" && scope.codexError && <p className="setting-detail">{scope.codexError}</p>}
        {agent === "claude" && scope.claude.length > 0 && <p className="setting-detail">Claude asks before using each listed MCP tool.</p>}
        {scope.unavailableServers?.[agent]?.length > 0 && <p className="setting-detail">Configured and unavailable for this run · {scope.unavailableServers[agent].join(", ")}</p>}
      </div>)}
    </div>
  </>;
}
