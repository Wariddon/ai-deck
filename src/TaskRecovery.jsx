import { useState } from "react";
import { HandoffLocation } from "./NativeRecents.jsx";
import { agentNames } from "./TeamThread.jsx";

const conflicts = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const freshnessLabels = {
  matched: "Checkout snapshot matches",
  changed: "Checkout changed since report",
  other: "Reported from another worktree",
  unknown: "No verified checkout snapshot",
};
const commandResult = (item) => Number.isInteger(item.exitCode) ? item.status + " · exit " + item.exitCode : item.status;

function changeGroups(entries) {
  const normal = entries.filter(({ index, worktree }) => index !== "?" && !conflicts.has(index + worktree));
  return [
    ["Staged", normal.filter(({ index }) => index !== " ").map(({ index, file }) => [index, file])],
    ["Unstaged", normal.filter(({ worktree }) => worktree !== " ").map(({ worktree, file }) => [worktree, file])],
    ["Untracked", entries.filter(({ index }) => index === "?").map(({ file }) => ["?", file])],
    ["Conflicts", entries.filter(({ index, worktree }) => conflicts.has(index + worktree)).map(({ index, worktree, file }) => [index + worktree, file])],
  ];
}

function commandList(items, showFreshness = false) {
  return items.length ? <ul className="delivery-list">{items.map((item) => <li key={item.agent + ":" + item.id}>
    <code>{item.subject || "Command"}</code>
    <small>{agentNames[item.agent]} · {commandResult(item)}{showFreshness && " · " + freshnessLabels[item.freshness]}</small>
    {item.output && <details className="linked-dirty"><summary>Recorded output</summary><pre>{item.output}</pre></details>}
  </li>)}</ul> : <p className="setting-detail">No command results recorded here.</p>;
}

export function recoveryPrompt(run, report) {
  const files = report.entries.slice(0, 30).map(({ index, worktree, file }) => index + worktree + " " + JSON.stringify(file).slice(0, 240));
  const commands = (run.evidence ?? []).filter(({ kind }) => kind === "command").slice(-8)
    .map((item) => item.subject.slice(0, 240) + " · " + commandResult(item));
  return [
    "Continue the interrupted task after inspecting the current checkout. Preserve existing working and staged changes. Verify the recorded outcomes before repeating any command.",
    "Previous request:\n" + run.prompt.slice(0, 7000),
    "Checkout reviewed in AI Deck: " + (report.checkout.branch || "detached HEAD") + " @ " + report.checkout.head,
    files.length && "Working changes seen in AI Deck (excerpt):\n" + files.join("\n"),
    commands.length && "Recorded command outcomes (quoted history):\n" + commands.join("\n"),
  ].filter(Boolean).join("\n\n");
}

function HandoffDrafts({ title, report, pending, copy }) {
  const [commit, setCommit] = useState(title === "New task" ? "" : title);
  const [pr, setPr] = useState(null);
  const matched = report.tests.find((item) => item.freshness === "matched");
  const prDraft = [
    "## Summary\n" + (title === "New task" ? "- Describe the change" : "- " + title),
    "## Changes\n" + (report.entries.slice(0, 15).map(({ file }) => "- " + JSON.stringify(file).slice(0, 300)).join("\n") || "- No working changes in this snapshot"),
    "## Verification\n" + (matched ? "- " + matched.subject + " (" + commandResult(matched) + ", checkout snapshot matches)" : "- Review test evidence for this checkout"),
    pending.length && "## Open steps\n" + pending.map(({ title: step }) => "- [ ] " + step).join("\n"),
  ].filter(Boolean).join("\n\n").slice(0, 16000);
  return <details className="delivery-section">
    <summary>Draft commit message and PR text</summary>
    <div className="thread-handoff-form">
      <label className="field"><strong>Commit message</strong><textarea rows={2} maxLength={16000} value={commit} onChange={(event) => setCommit(event.target.value)} /></label>
      <button className="button small" type="button" disabled={!commit.trim()} onClick={() => copy(commit)}>Copy commit message</button>
      <label className="field"><strong>PR description</strong><textarea rows={7} maxLength={16000} value={pr ?? prDraft} onChange={(event) => setPr(event.target.value)} /></label>
      <button className="button small" type="button" disabled={!(pr ?? prDraft).trim()} onClick={() => copy(pr ?? prDraft)}>Copy PR description</button>
    </div>
  </details>;
}

export function DeliveryReview({ report, recovery, busy, hasDraft, title, lane, hasLanes, refresh, continueDraft, copy }) {
  const pending = report?.steps.filter(({ status }) => status !== "done") ?? [];
  const groups = report && changeGroups(report.entries);
  const reports = report?.tests ?? [];
  const stagedCount = groups?.[0][1].length ?? 0;
  const latestPerCommand = reports.filter((item, index) =>
    item.freshness !== "other" && reports.findIndex((other) => other.freshness !== "other" && other.agent === item.agent && other.subject === item.subject) === index);
  const matchedPasses = latestPerCommand.filter((item) => item.freshness === "matched" && item.exitCode === 0 && item.status === "completed");
  const reasons = [
    groups?.[3][1].length && "Resolve Git conflicts",
    report?.truncated && "Review the rest of the file list in Git",
    pending.length && (pending.length + (pending.length === 1 ? " open checklist step" : " open checklist steps")),
    latestPerCommand.some(({ freshness }) => freshness === "changed") && "Checkout changed since the last test report",
    latestPerCommand.some(({ status, exitCode }) => status === "failed" || Number.isInteger(exitCode) && exitCode !== 0) && "Review failed tests",
    !latestPerCommand.length && "No tests reported for this checkout",
    latestPerCommand.length > 0 && matchedPasses.length !== latestPerCommand.length &&
      !latestPerCommand.some(({ freshness }) => freshness === "changed") && "Some results need verification in this checkout",
  ].filter(Boolean);
  return <div className="thread-handoff-form">
    {recovery && <section className="delivery-section">
      <strong>Interrupted turn · {new Date(recovery.startedAt).toLocaleString()}</strong>
      <pre className="delivery-prompt">{recovery.prompt}</pre>
      {Object.entries(recovery.agents).map(([agent, record]) => {
        const text = record.answer ?? record.messages?.at(-1)?.text;
        return text && <details key={agent} className="delivery-section">
          <summary>{agentNames[agent]} · Last saved reply</summary><pre className="delivery-prompt">{text}</pre>
        </details>;
      })}
      <details className="delivery-section" open>
        <summary>Commands already reported</summary>
        {commandList((recovery.evidence ?? []).filter(({ kind }) => kind === "command"))}
      </details>
    </section>}
    <div className="thread-actions">
      {hasLanes && <select aria-label="Checkout to review" value={lane} disabled={busy} onChange={(event) => refresh(event.target.value)}>
        <option value="main">Main worktree</option><option value="claude">Claude Code worktree</option>
      </select>}
      <button className="button small" type="button" disabled={busy} onClick={() => refresh(lane)}>Refresh checkout</button>
      {busy && <span className="setting-detail" role="status">Checking Git…</span>}
    </div>
    {report && <>
      {!recovery && <div className={"delivery-summary" + (reasons.length ? " needs-review" : "")} role="status">
        <strong>{reasons.length ? "Review before delivery" : "Recorded checks match this checkout"}</strong>
        {reasons.length > 0 && <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
        <small>{stagedCount} staged · {pending.length} open steps</small>
      </div>}
      <HandoffLocation label="Current checkout" location={{ ...report.checkout, repo: report.checkout.cwd, commit: report.checkout.head }} />
      <p className="setting-detail">Checked {new Date(report.checkedAt).toLocaleString()}</p>

      {report.truncated && <p className="live-error" role="status">The file list is incomplete. Review the remaining changes in Git.</p>}
      <div className="delivery-changes">
        {groups.map(([label, entries]) => <details className="delivery-section" key={label} open={Boolean(entries.length)}>
          <summary>{label} · {entries.length}</summary>
          {entries.length ? <ul className="delivery-list">{entries.map(([status, file]) => <li key={file}><code>{status} {file}</code></li>)}</ul>
            : <p className="setting-detail">None in this snapshot.</p>}
        </details>)}
      </div>
      {!recovery && <>
        <details className="delivery-section" open>
          <summary>Open checklist steps · {pending.length}</summary>
          {pending.length ? <ul className="delivery-list">{pending.map(({ id, title: step, status }) => <li key={id}>{step} · {status}</li>)}</ul>
            : <p className="setting-detail">{report.steps.length ? "All checklist steps are marked done." : "This task has no shared checklist."}</p>}
        </details>
        <details className="delivery-section" open>
          <summary>Reported test commands · {reports.length}</summary>
          {commandList(reports, true)}
        </details>
        <HandoffDrafts title={title} report={report} pending={pending} copy={copy} />
      </>}
    </>}
    {recovery && <div className="linked-send-footer">
      <span className="setting-detail">{hasDraft ? "Send or clear the current draft before continuing." : "Review the checkout and recorded outcomes, then edit the recovery draft."}</span>
      <button className="button small primary" type="button" disabled={!report || busy || hasDraft} onClick={() => continueDraft(report)}>Review &amp; continue</button>
    </div>}
  </div>;
}

export function UndoApply({ preview, busy, refresh, apply }) {
  const [confirmed, setConfirmed] = useState(false);
  return <div className="thread-handoff-form">
    <HandoffLocation label="Original checkout" location={preview.target} />
    <p className="setting-detail">Git verified these inverse changes against the original branch. Undo updates its working files and keeps the current staging.</p>
    {preview.patches.map(({ file, text }) => <details className="linked-dirty" key={file} open>
      <summary>{file}</summary><pre>{text}</pre>
    </details>)}
    <label className="thread-handoff-confirm"><input type="checkbox" checked={confirmed} disabled={busy}
      onChange={(event) => setConfirmed(event.target.checked)} />I reviewed the inverse patch and the original checkout is idle</label>
    <div className="linked-send-footer">
      <button className="button small" type="button" disabled={busy} onClick={refresh}>Refresh Undo Apply</button>
      <button className="button small primary" type="button" disabled={busy || !confirmed} onClick={apply}>Undo on {preview.target.branch}</button>
    </div>
  </div>;
}