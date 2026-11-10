import { useState } from "react";
import { IconGitBranch, IconPin } from "@tabler/icons-react";
import { agentNames, Brand, projectName } from "./TeamThread.jsx";

export function HandoffLocation({ label, location }) {
  return <div className="thread-handoff-location">
    <strong>{label}</strong>
    <span>{location.repo || "Repository unavailable"}</span>
    <span><IconGitBranch size={14} />{location.branch || (location.commit ? "Detached HEAD" : "Branch unavailable")}
      {location.commit && <code title={location.commit}>{location.commit.slice(0, 12)}</code>}</span>
  </div>;
}

const handoffModes = {
  "codex-review": "Codex · Review",
  codex: "Codex · Edit",
  claude: "Claude Code · Review",
  "claude-write": "Claude Code · Edit",
};

export function NativeSession({ preview, pinned, pin, older, busy, repositories, chooseRepo, action, create, link }) {
  const { session, messages, hasOlder, skipped } = preview;
  const [picked, setPicked] = useState(new Set());
  const [query, setQuery] = useState("");
  const [handoff, setHandoff] = useState(false);
  const [repo, setRepo] = useState("");
  const [mode, setMode] = useState(session.provider === "codex" ? "claude" : "codex-review");
  const [instruction, setInstruction] = useState("");
  const [check, setCheck] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const term = query.trim().toLocaleLowerCase();
  const chronological = messages ? [...messages].reverse() : [];
  const visible = chronological.filter(({ text }) => !term || text.toLocaleLowerCase().includes(term));
  const chosen = chronological.filter(({ id }) => picked.has(id));
  const total = chosen.reduce((sum, { text }) => sum + text.length, 0);
  const needsConfirmation = check && (check.comparison.repo === "different" || check.comparison.branch === "different");
  const canContinue = chosen.length > 0 && chosen.length <= 32 && total < 18000;
  const receiver = mode.startsWith("codex") ? "Codex" : "Claude Code";
  const editMode = ["codex", "claude-write"].includes(mode);
  const choices = [...new Set([repo, ...repositories.map((item) => item.repo)].filter(Boolean))];

  function toggle(id) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function verify(nextRepo) {
    setCheck(null);
    setConfirmed(false);
    const result = await action("native-handoff-check", { provider: session.provider, id: session.id, repo: nextRepo });
    if (result) {
      setRepo(result.repo);
      setCheck(result);
    }
  }

  function continueWithSelection() {
    setHandoff(true);
    void verify(repo);
  }

  return <div className="thread-session-preview">
    <div className="thread-session-heading">
      <p className={"thread-session-provider " + session.provider}>
        <Brand agent={session.provider} size={17} /><strong>{agentNames[session.provider]}</strong>
        {session.project && <span>· {session.project}</span>}
      </p>
      <button className="button small" type="button" disabled={busy} aria-pressed={pinned} onClick={pin}>
        <IconPin size={15} />{pinned ? "Unpin" : "Pin session"}
      </button>
    </div>
    <h3>{session.title}</h3>
    <p className="dialog-intro">Local session{session.updatedAt ? " · " + new Date(session.updatedAt).toLocaleString() : ""}</p>
    {!handoff && <div className="thread-session-paths">
      <section>
        <strong>Continue this session</strong>
        <p className="setting-detail">Resume the original chat in its repo, or fork it into a separate worktree.</p>
        <button className="button small primary" type="button" disabled={busy} onClick={link}>Check session &amp; checkout</button>
      </section>
      <section>
        <strong>Hand off selected messages</strong>
        <p className="setting-detail">Start a draft for either agent using only the excerpts you select below.</p>
        <button className="button small" type="button" aria-label="Continue with selected messages" disabled={busy || !canContinue}
          onClick={continueWithSelection}>{chosen.length ? "Hand off " + chosen.length + (chosen.length === 1 ? " message" : " messages") : "Choose messages below"}</button>
      </section>
    </div>}
    {handoff ? <div className="thread-handoff-form">
      <div className="thread-session-heading">
        <button className="button small" type="button" disabled={busy} onClick={() => setHandoff(false)}>Back to messages</button>
        <span className="setting-detail">{chosen.length} selected · opens a draft</span>
      </div>
      <div className="thread-handoff-fields">
        <label className="field"><strong>Receiving agent</strong>
          <select value={mode} disabled={busy} onChange={(event) => setMode(event.target.value)}>
            {Object.entries(handoffModes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="field"><strong>Destination repository</strong>
          <select value={repo} disabled={busy} onChange={(event) => {
            setRepo(event.target.value);
            void verify(event.target.value);
          }}>
            <option value="">Find from this chat</option>
            {choices.map((repo) => <option key={repo} value={repo} title={repo}>{projectName(repo)}</option>)}
          </select>
        </label>
      </div>
      <div className="thread-actions">
        <button className="button small" type="button" disabled={busy} onClick={async () => {
          const result = await chooseRepo();
          if (result?.workspace?.repo) {
            setRepo(result.workspace.repo);
            void verify(result.workspace.repo);
          }
        }}>Open repository</button>
        <button className="button small" type="button" disabled={busy} onClick={() => verify(repo)}>Recheck repo &amp; branch</button>
        {!check && busy && <span role="status">Checking repo and branch…</span>}
      </div>
      {check && <>
        <HandoffLocation label="Verified destination" location={check.target} />
        {(check.source.repo || check.source.branch) && <details className="thread-handoff-source" open={needsConfirmation || undefined}>
          <summary>Original chat location</summary>
          <HandoffLocation label="Source session · recorded branch" location={check.source} />
        </details>}
        {check.comparison.repo !== "same" && <p className="setting-detail" role="status">
          {check.comparison.repo === "different" ? "Source and destination are different repositories." : "The source repository could not be verified."}
        </p>}
        {check.comparison.branch !== "same" && <p className="setting-detail" role="status">
          {check.comparison.branch === "different" ? "Source and destination branches differ." : "The source session has no recorded branch."}
        </p>}
        {needsConfirmation && <label className="thread-handoff-confirm">
          <input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
          Use this destination for the handoff
        </label>}
        <label className="field"><strong>What should the agent do?</strong>
          <textarea value={instruction} disabled={busy} rows={2} maxLength={4000}
            onChange={(event) => setInstruction(event.target.value)} placeholder="Review the selected plan and flag risks." />
        </label>
        {check.readOnly && editMode && <p className="setting-detail" role="status">This project is read-only. Choose a review mode.</p>}
        <button className="button small primary" type="button" disabled={busy || !instruction.trim() ||
          (needsConfirmation && !confirmed) || (check.readOnly && editMode)} onClick={() =>
          create({ provider: session.provider, id: session.id, mode, instruction, messages: chosen, repo: check.repo, checked: check.target, confirmed })}>
          Draft for {receiver} on {check.target.branch || "detached HEAD"}
        </button>
      </>}
    </div> : <>
      {!messages && busy && <p role="status">Loading session…</p>}
      {messages && <>
        <div className="thread-session-controls">
          <input className="thread-search" type="search" aria-label="Search in this chat" placeholder="Search in this chat…" maxLength={200}
            value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && term && hasOlder && !busy && !event.nativeEvent.isComposing) void older(term);
            }} />
          <div className="thread-actions">
            <span role="status">{chosen.length ? `${chosen.length} selected` : "Select messages to hand off."}
              {term && ` · ${visible.length} matches${hasOlder ? " in loaded messages" : ""}`}</span>

          </div>
          {(chosen.length > 32 || total >= 18000) && <p className="setting-detail">Select fewer messages to fit the draft.</p>}
        </div>
        {hasOlder && <button className="button small" type="button" disabled={busy} onClick={() => older(term)}>
          {busy ? "Loading…" : term ? "Search older messages" : "Load older messages"}
        </button>}
        {skipped && <p className="setting-detail">Some very large transcript records were skipped.</p>}
        {!visible.length && <p className="setting-detail">{term ? "No matches in loaded messages." : "No readable messages in this page."}</p>}
        {visible.map(({ id, role, text, clipped }, index) => <article key={id} className={role}>
          <label className="thread-message-pick">
            <input type="checkbox" aria-label={`Select message ${index + 1} from ${role === "user" ? "you" : agentNames[session.provider]}`}
              disabled={clipped || text.length >= 18000} checked={picked.has(id)} onChange={() => toggle(id)} />
            <strong>{role === "user" ? "You" : agentNames[session.provider]}</strong>
          </label>
          <p>{text}</p>
          {(clipped || text.length >= 18000) && <p className="setting-detail">This message is too long to forward in one draft.</p>}
        </article>)}
      </>}
    </>}
  </div>;
}
