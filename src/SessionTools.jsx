import { useEffect, useState } from "react";
import { IconArchive, IconDots, IconEdit, IconGitBranch, IconRestore, IconTrash } from "@tabler/icons-react";
import { sessionKey } from "../desktop/session-selection.mjs";

const deletionScopes = {
  deck: ["AI Deck tasks", "Deletes the task history and draft. Git worktrees stay on disk."],
  codex: ["Codex source chats", "Permanently deletes the source chat and its descendant chats. Forks can prevent deletion."],
  claude: ["Claude Code local source chats", "Permanently deletes the local transcript. Claude Code terminals and Claude Desktop must be closed."],
};

export function BatchSessionDeletion({ entries, result, busy, perform, close }) {
  const [confirmed, setConfirmed] = useState(false);
  const outcomes = new Map(result?.results.map((entry) => [sessionKey(entry), entry]) ?? []);
  const deleted = result?.results.filter((entry) => entry.deleted).length ?? 0;
  return <form className="deck-session-actions" onSubmit={(event) => {
    event.preventDefault();
    if (confirmed && !busy && !result) void perform();
  }}>
    {result
      ? <p className="dialog-intro" role="status">{deleted} deleted · {entries.length - deleted} kept</p>
      : <p className="dialog-intro">Review the {entries.length} selected {entries.length === 1 ? "chat" : "chats"}. Deletion is permanent.</p>}
    <div className="deck-batch-list">
      {Object.entries(deletionScopes).map(([scope, [title, description]]) => {
        const group = entries.filter((entry) => (entry.provider ?? "deck") === scope);
        if (!group.length) return null;
        return <section key={scope}>
          <h3>{title} · {group.length}</h3>
          {!result && <p className="setting-detail">{description}</p>}
          <ul>{group.map((entry) => {
            const outcome = outcomes.get(sessionKey(entry));
            return <li key={sessionKey(entry)}>
              <span>{entry.title}</span>
              {(entry.project || entry.repo || entry.archived) && <small className="setting-detail">
                {[entry.project ?? entry.repo?.split(/[\\/]/u).at(-1), entry.archived && "Archived"].filter(Boolean).join(" · ")}
              </small>}
              {outcome && <small className={outcome.deleted ? "setting-detail" : "deck-batch-failure"}>
                {outcome.deleted ? "Deleted" : outcome.error}
              </small>}
            </li>;
          })}</ul>
        </section>;
      })}
    </div>
    {result?.warning && <p className="setting-detail" role="status">{result.warning}</p>}
    {!result && <label className="setting-row">
      <input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
      <span>Permanently delete the {entries.length} listed {entries.length === 1 ? "chat" : "chats"}</span>
    </label>}
    <div className="dialog-actions">
      <button className="button small" type="button" disabled={busy} onClick={close}>{result ? "Done" : "Cancel"}</button>
      {!result && <button className="button small thread-delete-button" disabled={busy || !confirmed}>
        <IconTrash size={15} />{busy ? "Deleting…" : "Delete permanently"}
      </button>}
    </div>
  </form>;
}

export function SessionButton({ entry, busy, manage }) {
  return <button className="icon-button thread-session-menu-button" type="button" disabled={busy}
    aria-label={"Manage session " + entry.title} title="Session actions" onClick={() => manage(entry)}><IconDots size={16} /></button>;
}

export function SessionActions({ entry, busy, perform }) {
  const [action, setAction] = useState("");
  const [title, setTitle] = useState(entry.title.slice(0, 100));
  const [confirmed, setConfirmed] = useState(false);
  const scope = entry.provider === "codex" ? "Codex source chat" : entry.provider === "claude" ? "Claude Code local source chat" : "AI Deck task";
  const choices = [
    ...(!entry.archived ? [...(!entry.provider ? [["fork", "Fork", IconGitBranch]] : []),
      ["archive", "Archive", IconArchive]]
      : [["restore", "Restore", IconRestore]]),
    ["rename", "Rename", IconEdit], ["delete", "Delete", IconTrash],
  ];
  const labels = Object.fromEntries(choices.map(([value, label]) => [value, label]));
  const details = {
    fork: "Copy supported Git changes and recent conversation excerpts into a new AI Deck task. The copy starts unstaged.",
    archive: entry.provider ? "Archive this conversation in its source history. Restore it before continuing from Recents."
      : "Move this task to Archived. You can restore it from the sidebar.",
    restore: "Return this session to the active list.",
    delete: entry.provider === "codex" ? "Permanently delete the Codex source transcript and its descendant chats."
      : entry.provider === "claude" ? "Permanently delete this local Claude Code transcript."
        : "Permanently delete this task’s AI Deck history. Its Git worktrees stay on disk.",
  };
  return <div className="deck-session-actions">
    <span className="source-pill">{scope}{entry.archived ? " · Archived" : ""}</span>
    <h3>{entry.title}</h3>
    {entry.provider === "claude" && <p className="setting-detail">Source transcript changes require closed Claude Code sessions.</p>}
    {!action ? <div className="deck-session-action-grid">
      {choices.map(([value, label, Icon]) => <button key={value} type="button" className="button small" disabled={busy}
        onClick={() => setAction(value)}><Icon size={16} />{label}</button>)}
    </div> : <form onSubmit={(event) => {
      event.preventDefault();
      if (busy || action === "delete" && !confirmed || action === "rename" && !title.trim()) return;
      void perform(action, action === "rename" ? { title } : action === "delete" ? { confirm: entry.id } : {});
    }}>
      {details[action] && <p className="setting-detail">{details[action]}</p>}
      {action === "rename" && <label className="field"><strong>Session name</strong>
        <input autoFocus required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>}
      {action === "delete" && <label className="setting-row"><input type="checkbox" checked={confirmed}
        onChange={(event) => setConfirmed(event.target.checked)} /><span>Delete this {scope.toLowerCase()} permanently</span></label>}
      <div className="dialog-actions">
        <button className="button small" type="button" disabled={busy} onClick={() => { setAction(""); setConfirmed(false); }}>Back</button>
        <button className="button primary small" disabled={busy || action === "delete" && !confirmed || action === "rename" && !title.trim()}>
          {action === "delete" ? "Delete permanently" : labels[action]}
        </button>
      </div>
    </form>}
  </div>;
}

function linkText(page) {
  if (!page.html) return { title: "", text: page.body.trim() };
  const document = new DOMParser().parseFromString(page.body, "text/html");
  document.querySelectorAll("script,style,noscript,template,iframe,object,svg,nav,footer,form,[hidden],[aria-hidden=true]").forEach((element) => element.remove());
  const content = document.querySelector("main, article, [role=main]") ?? document.body;
  content.querySelectorAll("p,li,br,div,section,h1,h2,h3,h4,tr,pre").forEach((element) => element.before("\n"));
  return { title: document.title.trim().slice(0, 180), text: content.textContent.trim().replace(/[ \t]+/gu, " ").replace(/\n{3,}/gu, "\n\n") };
}

export function LinkAttachment({ initialUrl, busy, preview, attach }) {
  const [url, setUrl] = useState(initialUrl);
  const [page, setPage] = useState(null);
  async function load(event) {
    event.preventDefault();
    setPage(null);
    const next = await preview(url);
    if (!next) return;
    const { title, text } = linkText(next);
    setPage({ title, text: text.slice(0, 6000), clipped: text.length > 6000, url: next.url });
  }
  return <div className="deck-session-actions">
    <p className="dialog-intro">Preview the page text, then add it to your draft for either agent.</p>
    <form className="deck-link-form" onSubmit={load}>
      <label className="field"><strong>Page URL</strong><input autoFocus type="url" required maxLength={2000} value={url}
        onChange={(event) => { setUrl(event.target.value); setPage(null); }} placeholder="https://example.com" disabled={busy} /></label>
      <button className="button small" disabled={busy || !url.trim()}>{busy ? "Reading page…" : "Preview link"}</button>
    </form>
    {page && <>
      <strong className="deck-link-address">{page.title || page.url}</strong>
      <pre className="file-preview deck-link-preview">{page.text || "This page returned no readable text. Try pasting the text or attaching a window capture."}</pre>
      {page.clipped && <p className="setting-detail">Preview limited to the first 6,000 characters.</p>}
      <div className="dialog-actions"><button className="button primary small" type="button" disabled={busy || !page.text}
        onClick={() => attach(page)}>Attach to draft</button></div>
    </>}
  </div>;
}

export function WindowAttachment({ api, windows, busy, refresh, capture, attach, providers, chromeOnly, canEdit }) {
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState(null);
  const [agent, setAgent] = useState(providers?.[0]?.[0] ?? "");
  const [access, setAccess] = useState("browse");
  useEffect(() => () => { void api["cancel-window-capture"]().catch(() => {}); }, [api]);
  return <div className="deck-session-actions">
    <p className="dialog-intro">{chromeOnly ? "Choose an open Chrome window and one agent for the next turn. AI Deck asks before each click, text change or navigation." :
      providers ? "Share one window with one agent for the next turn. The agent can receive screenshots and accessible controls. AI Deck asks before each click or text change. Send within five minutes." :
      "Choose a window and check the image before attaching it to your draft."}</p>
    <div className="deck-link-form">
      <label className="field"><strong>Window</strong><select value={selected} disabled={busy}
        onChange={(event) => { setSelected(event.target.value); setPreview(null); }}>
        <option value="">Choose a window</option>
        {windows.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <button className="button small" type="button" disabled={busy} onClick={() => { setSelected(""); setPreview(null); void refresh(); }}>Refresh</button>
      <button className="button small" type="button" disabled={busy || !selected} onClick={async () => {
        setPreview(null);
        setPreview(await capture(selected));
      }}>{busy ? "Working…" : "Preview capture"}</button>
    </div>
    {chromeOnly && !busy && !windows.length && <p className="setting-detail">Open a Google Chrome window, then select Refresh.</p>}
    {preview && <>
      <img className="deck-window-preview" src={preview.image} alt={"Preview of " + preview.name} />
      {providers && <p className="setting-detail">{preview.controls
        ? preview.controls + " accessible controls found in this preview."
        : "Screenshot available. This window exposes no supported controls right now."}</p>}
      {providers && <label className="field"><strong>Share with</strong><select value={agent} disabled={busy} onChange={(event) => setAgent(event.target.value)}>
        {providers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
      {providers && preview.chrome && <label className="field"><strong>Turn access</strong>
        <select value={access} disabled={busy} onChange={(event) => setAccess(event.target.value)}>
          <option value="browse">Browse only</option>
          <option value="edit" disabled={!canEdit}>Browse and edit worktree files</option>
        </select>
        <small>Chrome actions are approved separately. The share expires in five minutes if you do not send.</small>
      </label>}
      <div className="dialog-actions"><button className="button primary small" type="button" disabled={busy || Boolean(providers && !agent)}
        onClick={() => attach(preview.token, agent, preview.chrome && canEdit ? access : "browse")}>{providers ? "Share for next turn" : "Attach image"}</button></div>
    </>}
  </div>;
}
