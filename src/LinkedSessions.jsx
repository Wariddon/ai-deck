import { useEffect, useMemo, useRef, useState } from "react";
import { IconChevronRight, IconRefresh } from "@tabler/icons-react";
import { agentNames, Brand, ChatTimestamp } from "./TeamThread.jsx";
import { HandoffLocation } from "./NativeRecents.jsx";
import { DeckLoading } from "./DeckLoading.jsx";
import { groupLinkedCommands, linkedNextAction, linkedTimelineRows, mergeLinkedPage } from "./linked-timeline.mjs";
import { OnDemandDetails, WorkSteps } from "./WorkActivity.jsx";

export const linkedModeNames = {
  "codex-review": "Codex · Review", codex: "Codex · Edit",
  claude: "Claude Code · Review", "claude-write": "Claude Code · Edit",
};

export function LinkedCheckout({ target }) {
  return <>
    <HandoffLocation label="Git checkout" location={target} />
    {target.cwd !== target.repo && <p className="setting-detail">Session folder · {target.cwd}</p>}
    {target.status ? <details className="linked-dirty" open>
      <summary>Working changes · {target.status.trim().split(/\r?\n/u).length} entries</summary>
      <pre>{target.status}</pre>
    </details> : <p className="setting-detail">Working tree clean</p>}
    {!target.stamp && <p className="setting-detail">File contents could only be partially verified.</p>}
  </>;
}

export function LinkedSource({ session, check, busy, refresh, open, fork = false }) {
  const [folderMode, setFolderMode] = useState(fork ? "copy" : "original");
  const [paused, setPaused] = useState(false);
  return <div className="thread-handoff-form">
    <p className="thread-session-provider"><Brand agent={session.provider} size={17} /><strong>{session.title}</strong></p>
    {check ? <>
      <LinkedCheckout target={check.target} />
      {check.recordedBranch && check.recordedBranch !== check.target.branch && <p className="setting-detail">
        The original chat recorded branch {check.recordedBranch}. Review the current checkout above.
      </p>}
      {check.active && <p className="setting-detail" role="status">The source is still working. Open the conversation to watch it, or refresh after the turn.</p>}
      <fieldset className="thread-session-paths"><legend>Choose where to continue</legend>
        <label className="thread-session-option"><input type="radio" name="linked-folder" value="original" checked={folderMode === "original"}
          disabled={busy} onChange={() => { setFolderMode("original"); setPaused(false); }} />
          <span><strong>Original session</strong><small>Same chat and checkout shown above.</small></span>
        </label>
        <label className="thread-session-option"><input type="radio" name="linked-folder" value="copy" checked={folderMode === "copy"}
          disabled={busy} onChange={() => setFolderMode("copy")} />
          <span><strong>Separate worktree</strong><small>Fork the conversation on its first turn in the copy.</small></span>
        </label>
      </fieldset>
      {folderMode === "copy" && <>
        <p className="setting-detail">The copy includes tracked edits and supported non-ignored new files. Copied changes start unstaged.</p>
        <label className="thread-handoff-confirm">
          <input type="checkbox" checked={paused} disabled={busy || check.active} onChange={(event) => setPaused(event.target.checked)} />
          The source has finished its turn and stopped editing this folder
        </label>
      </>}
      <div className="thread-actions">
        <button className="button small primary" type="button" disabled={busy ||
          (folderMode === "copy" && (!paused || check.active || !check.target.stamp))}
          onClick={() => open({ provider: session.provider, id: session.id, folderMode, paused, target: check.target, revision: check.revision })}>
          {folderMode === "original" ? "Open linked conversation" : "Create separate copy"}
        </button>
      </div>
    </> : busy && <p role="status">Reading the session and Git checkout…</p>}
    <button className="button small" type="button" disabled={busy} onClick={refresh}>Refresh source check</button>
  </div>;
}

const time = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
const formatTime = (value) => value ? time.format(new Date(value)) : "Time unavailable";
const checkLabel = (check) => check.subject + " · " + check.status + (Number.isInteger(check.exitCode) ? " · exit " + check.exitCode : "");

function Receipt({ receipt, status, target }) {
  return <details className="linked-dirty">
    <summary>{status === "completed" ? "Received by " : "Delivery unconfirmed · "}{agentNames[target]}
      {receipt.count ? " · " + receipt.count + " messages" : ""}
      {receipt.files?.length ? " · " + receipt.files.length + " files" : ""}
      {receipt.checks?.length ? " · " + receipt.checks.length + " results" : ""}</summary>
    {receipt.at && <span className="setting-detail">{formatTime(receipt.at)}</span>}
    {receipt.from && <p className="setting-detail">Context from {agentNames[receipt.from]}</p>}
    {receipt.excerpts && <pre>{receipt.excerpts}</pre>}
    {receipt.files?.length > 0 && <ul>{receipt.files.map((file) => <li key={file}>{file}</li>)}</ul>}
    {receipt.checks?.length > 0 && <ul>{receipt.checks.map((check, index) => <li key={index}>{checkLabel(check)}</li>)}</ul>}
    {receipt.evidenceText && <details className="linked-dirty"><summary>Evidence sent</summary><pre>{receipt.evidenceText}</pre></details>}
    {receipt.evidenceHash && <p className="setting-detail">Evidence SHA-256 · <code title={receipt.evidenceHash}>{receipt.evidenceHash.slice(0, 12)}</code></p>}
  </details>;
}

export function LinkedSend({ preview, draft, busy, send, prepareAttachments }) {
  const [paused, setPaused] = useState(false);
  const [include, setInclude] = useState(true);
  const [files, setFiles] = useState([]);
  const [checks, setChecks] = useState([]);
  const [attachment, setAttachment] = useState(null);
  const selected = files.length + checks.length;
  function toggle(items, setItems, key) {
    setAttachment(null);
    setItems(items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
  }
  return <div className="thread-handoff-form">
    <div className="thread-send-target"><Brand agent={preview.agent} size={18} /><strong>Send to {agentNames[preview.agent]}</strong>
      <span className="source-pill">{linkedModeNames[draft.mode]?.split(" · ").at(-1)}</span>
    </div>
    <details className="linked-dirty"><summary>Your message{draft.images?.length ? " · " + draft.images.length + " images attached" : ""}</summary>
      <pre>{draft.prompt || "Image-only message"}</pre>
    </details>
    <LinkedCheckout target={preview.target} />
    {preview.changed && <p className="setting-detail">Git changed since the last verified turn. Check the branch and working changes above.</p>}
    {preview.busy ? <p className="setting-detail" role="status">A native turn is still in progress. Try Send after it finishes.</p> :
      <label className="thread-handoff-confirm">
        <input type="checkbox" checked={paused} disabled={busy} onChange={(event) => setPaused(event.target.checked)} />
        The original app is idle. Keep it idle while sending from AI Deck
      </label>}
    {(preview.receipts ?? []).length > 0 && <details className="linked-dirty">
      <summary>Earlier handoffs to {agentNames[preview.agent]}</summary>
      {preview.receipts.map((receipt) => <Receipt key={receipt.runId} receipt={receipt} status={receipt.status} target={preview.agent} />)}
    </details>}
    {preview.context && <>
      <label className="thread-handoff-confirm">
        <input type="checkbox" checked={include} disabled={busy} onChange={(event) => setInclude(event.target.checked)} />
        Include {preview.context.count} recent messages from {agentNames[preview.context.provider]}
      </label>
      {include && <details className="linked-dirty">
        <summary>Preview the handoff context</summary><pre>{preview.context.text}</pre>
      </details>}
    </>}
    <p className="setting-detail">Choose evidence to include in this turn. The agent can still inspect the checkout within its permissions.</p>
    <details className="linked-dirty">
      <summary>Attach Git diff · {files.length} selected</summary>
      <div className="linked-evidence-picker">
        {preview.files?.length ? preview.files.map(({ file, kind }) => <label className="thread-handoff-confirm" key={file}>
          <input type="checkbox" checked={files.includes(file)} disabled={busy || (!files.includes(file) && files.length >= 6)}
            onChange={() => toggle(files, setFiles, file)} />
          <span>{file} <small>{kind === "new" ? "· New file" : "· Diff"}</small></span>
        </label>) : <p className="setting-detail">No shareable changed files in this checkout.</p>}
      </div>
    </details>
    <details className="linked-dirty">
      <summary>Attach test / command results · {checks.length} selected</summary>
      <div className="linked-evidence-picker">
        {preview.checks?.length ? preview.checks.map((check) => <label className="thread-handoff-confirm" key={check.selectionId}>
          <input type="checkbox" checked={checks.includes(check.selectionId)} disabled={busy || (!checks.includes(check.selectionId) && checks.length >= 8)}
            onChange={() => toggle(checks, setChecks, check.selectionId)} />
          <span>{checkLabel(check)} <small>{agentNames[check.agent]} · {formatTime(check.at)}</small></span>
        </label>) : <p className="setting-detail">Run a test in a linked turn to record a result here.</p>}
      </div>
    </details>
    {selected > 0 && <>
      <div className="thread-actions">
        <button className="button small" type="button" disabled={busy || preview.busy} onClick={async () => {
          setAttachment(await prepareAttachments({ files, checks }));
        }}>Preview selected evidence</button>
        <span className="setting-detail">{attachment ? "Evidence ready to send" : "Preview the selection before sending"}</span>
      </div>
      {attachment && <details className="linked-dirty" open><summary>Evidence that will be sent</summary><pre>{attachment.text}</pre></details>}
    </>}
    <div className="linked-send-footer">
      <span className="setting-detail">{include && preview.context ? preview.context.count + " quoted messages" : "No peer quotes"}
        {" · "}{files.length} files · {checks.length} command results</span>
      <button className="button small primary" type="button" disabled={busy || preview.busy || !paused || (selected > 0 && !attachment)}
        onClick={() => send(include, attachment?.id)}>Send to {agentNames[preview.agent]}</button>
    </div>
  </div>;
}

export function EditLinkedNext({ next, busy, save }) {
  const [mode, setMode] = useState(next.mode);
  const [text, setText] = useState(next.text);
  return <form className="thread-handoff-form" onSubmit={(event) => {
    event.preventDefault();
    void save({ mode, text });
  }}>
    <label className="field"><strong>Agent for the next step</strong>
      <select value={mode} onChange={(event) => setMode(event.target.value)} disabled={busy}>
        {Object.entries(linkedModeNames).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
      </select>
    </label>
    <label className="field"><strong>Next step</strong>
      <textarea value={text} maxLength={2400} rows={4} onChange={(event) => setText(event.target.value)} disabled={busy} />
    </label>
    <div className="thread-actions">
      <button className="button small primary" type="submit" disabled={busy || !text.trim()}>Save next step</button>
      {next.saved && <button className="button small" type="button" disabled={busy} onClick={() => save({ mode, text: "" })}>Clear saved step</button>}
    </div>
  </form>;
}

function NextCard({ link, runs, busy, draftOpen, edit, draft }) {
  const next = linkedNextAction(link, runs);
  const latest = runs.findLast((run) => run.finishedAt);
  const agent = latest && Object.keys(latest.agents)[0];
  return <aside className="linked-next-card" aria-label="Continue from here">
    <div>
      <strong>Continue from here</strong>
      <p className="setting-detail">{link.target.branch || "Detached HEAD"} · {link.target.commit.slice(0, 12)}
        {agent && " · Last AI Deck turn: " + agentNames[agent] + " · " + latest.agents[agent].status}
      </p>
      {latest?.prompt && <p className="setting-detail" title={latest.prompt}>Last request · {latest.prompt.replace(/\s+/gu, " ").slice(0, 150)}</p>}
      <p>{next.text}</p>
      <span className="setting-detail">{next.saved ? "Saved next step" : "Suggested next step"} · {linkedModeNames[next.mode]}</span>
    </div>
    <div className="thread-actions">
      <button className="button small" type="button" disabled={busy} onClick={() => edit(next)}>Edit next step</button>
      <button className="button small primary" type="button" disabled={busy || draftOpen} title={draftOpen ? "A draft is already open" : undefined}
        onClick={() => draft(next)}>Draft next step</button>
    </div>
  </aside>;
}

export function LinkedTimeline({ api, taskId, agent, link, runs, busy, draftOpen, openNative, copy, openRun, editNext, draftNext, workflows, watchRequest }) {
  const [pages, setPages] = useState({});
  const [filter, setFilter] = useState("all");
  const [watch, setWatch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(null);
  const live = useRef(true);
  const scroll = useRef(null);
  const loaded = Object.keys(pages).length > 0;

  async function load(provider, cursor, automatic = false) {
    if (busy || (automatic && document.hidden) || (running.current && (!running.current.automatic || automatic))) return;
    const request = { automatic };
    running.current = request;
    if (!automatic) setLoading(true);
    const viewport = scroll.current;
    const oldHeight = viewport?.scrollHeight ?? 0;
    const oldTop = viewport?.scrollTop ?? 0;
    const nearEnd = viewport && oldHeight - viewport.clientHeight - oldTop < 40;
    try {
      const result = provider
        ? { [provider]: await api["linked-history"]({ taskId, agent: provider, cursor }) }
        : await api["linked-timeline"]({ taskId, automatic });
      if (!result || !live.current || running.current !== request) return;
      setError("");
      setPages((current) => {
        const changed = Object.entries(result).map(([agent, page]) => [agent, mergeLinkedPage(current[agent], page, Boolean(cursor))])
          .filter(([agent, page]) => current[agent] !== page);
        return changed.length ? { ...current, ...Object.fromEntries(changed) } : current;
      });
      if (cursor || (automatic && nearEnd)) requestAnimationFrame(() => {
        if (!scroll.current || !live.current || (running.current && running.current !== request)) return;
        if (cursor) scroll.current.scrollTop = oldTop + scroll.current.scrollHeight - oldHeight;
        else if (automatic && nearEnd) scroll.current.scrollTop = scroll.current.scrollHeight;
      });
    } catch (reason) {
      if (live.current && running.current === request && !automatic) setError(String(reason.message || reason).replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, ""));
    } finally {
      if (running.current === request) {
        running.current = null;
        if (live.current && !automatic) setLoading(false);
      }
    }
  }

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  useEffect(() => {
    if (!busy && !loaded && !error) void load();
    if (busy || !watch) return;
    const timer = setInterval(() => void load(undefined, undefined, true), 12000);
    return () => clearInterval(timer);
  }, [busy, watch, loaded, Boolean(error)]);

  useEffect(() => {
    if (watchRequest) {
      setWatch(true);
      void load(undefined, undefined, true);
    }
  }, [watchRequest]);

  const timeline = useMemo(() => groupLinkedCommands(linkedTimelineRows(pages, runs, filter)), [pages, runs, filter]);
  return <section className="linked-history" ref={scroll} aria-label="Combined linked timeline">
    <header className="linked-history-actions">
      <div className="thread-actions" role="group" aria-label="Timeline provider">
        {Object.entries({ all: "Combined", ...agentNames }).map(([key, label]) => <button key={key} className="button small"
          type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
      </div>
      <div className="thread-actions">
        <button className="button small" type="button" disabled={busy || loading} onClick={() => load()}><IconRefresh size={14} />Refresh</button>
        <button className="button small" type="button" aria-pressed={watch} onClick={() => setWatch(!watch)}>Watch sources</button>
        {Object.keys(agentNames).filter((provider) => link.refs[provider] || link.source.provider === provider).map((provider) =>
          <button key={provider} className="button small" type="button" disabled={busy || loading} onClick={() => openNative(provider)}>
            Open in {agentNames[provider]}
          </button>)}
        {pages[agent]?.available && <button className="button small" type="button" disabled={busy} onClick={() => copy(agent)}>Copy resume command</button>}
      </div>
    </header>
    <NextCard link={link} runs={runs} busy={busy} draftOpen={draftOpen} edit={editNext} draft={draftNext} />
    {workflows}
    {loading && !loaded && <DeckLoading>Loading conversations…</DeckLoading>}
    {error && <p className="live-error" role="alert">{error}</p>}
    {pages[agent] && !pages[agent].available && !pages[agent].error &&
      <p className="setting-detail">Send a message to start this provider in the same linked task.</p>}
    {Object.entries(pages).map(([provider, page]) => <div key={provider} className="linked-source-status">
      {page.error && <p className="setting-detail" role="alert">{agentNames[provider]} · {page.error}</p>}
      {page.active && <p className="setting-detail" role="status">{agentNames[provider]} · Source turn in progress</p>}
      {page.cursor && (filter === "all" || filter === provider) && <button className="button small" type="button" disabled={busy || loading}
        onClick={() => load(provider, page.cursor)}>Older {agentNames[provider]} messages</button>}
    </div>)}
    {timeline.map((row, index) => {
      if (row.kind === "message") return <div key={row.key} className="linked-chat-row">
        <ChatTimestamp at={row.at} previousAt={timeline[index - 1]?.at} />
        {row.message.role === "user" ? <div className="thread-prompt">
          <div className="thread-prompt-body"><div className="thread-chat-author" title={formatTime(row.at)}>
            You · {agentNames[row.agent]}
          </div><p>{row.message.text}{row.message.clipped && "…"}</p></div>
        </div> : <div className="thread-chat-reply">
          <div className="thread-chat-author" title={formatTime(row.at)}><Brand agent={row.agent} size={13} /><strong>{agentNames[row.agent]}</strong></div>
          <p className="thread-message">{row.message.text}{row.message.clipped && "…"}</p>
        </div>}
      </div>;
      if (row.kind === "commands") return <div key={row.key} className="linked-chat-row thread-chat-work">
        <OnDemandDetails summary={<>
          {agentNames[row.agent]} · {row.commands.length} {row.commands.length === 1 ? "work step" : "work steps"}<IconChevronRight size={15} aria-hidden="true" />
        </>}>
          <WorkSteps steps={row.commands.map(({ key, evidence }) => ({
            id: key, command: checkLabel(evidence), text: [checkLabel(evidence), evidence.output].filter(Boolean).join("\n"),
          }))} />
        </OnDemandDetails>
      </div>;
      return <article key={row.key} className="linked-event">
        <header className="linked-event-title">
          <Brand agent={row.agent} size={15} /><strong>{agentNames[row.agent]}</strong>
          <small>{formatTime(row.at)}</small>
        </header>
        {row.kind === "handoff" && <Receipt receipt={row.receipt} status={row.status} target={row.agent} />}
        {row.kind === "result" && <div className="linked-run-result">
          <span>Turn · {row.status}{row.git?.changed === true && " · Git changed during this turn"}</span>
          <button className="button small" type="button" onClick={() => openRun(row.runId)}>Open run</button>
          {row.git && <details className="linked-dirty">
            <summary>Git at finish · {row.git.branch || "Detached HEAD"} · {row.git.after.slice(0, 12)}</summary>
            <pre>{row.git.status || "Working tree clean"}</pre>
          </details>}
        </div>}
      </article>;
    })}
  </section>;
}
