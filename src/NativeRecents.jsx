import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { IconArrowUp, IconDots, IconGitBranch, IconRefresh, IconPlayerStop, IconShieldCheck } from "@tabler/icons-react";
import { agentNames, Brand, projectName, PermissionPicker, QuestionCard, ImageChips, ChatTimestamp } from "./TeamThread.jsx";
import { nativePermissionModes } from "../desktop/native-chat-policy.mjs";
import { nativeChatEvent } from "./native-chat-events.mjs";
import { commandSummary } from "./command-activity.mjs";
import { discussionMode } from "../desktop/collaboration.mjs";
import { ChatMarkdown } from "./ChatMarkdown.jsx";
import { ControlPopover } from "./ControlPopover.jsx";
import { NativeModelPicker } from "./NativeModelPicker.jsx";
import { ComposerAttachments } from "./ComposerAttachments.jsx";
import { useNativeAttachments } from "./NativeAttachments.jsx";

function recentForkMessages(messages = []) {
  const recent = [];
  let remaining = 6000;
  for (const message of messages) {
    if (message.clipped || message.text.length > remaining) continue;
    recent.push(message);
    remaining -= message.text.length;
    if (recent.length === 6) break;
  }
  return recent.reverse();
}

export function HandoffLocation({ label, location }) {
  return <div className="thread-handoff-location">
    <strong>{label}</strong>
    <span>{location.repo || "Repository unavailable"}</span>
    <span><IconGitBranch size={14} />{location.branch || (location.commit ? "Detached HEAD" : "Branch unavailable")}
      {location.commit && <code title={location.commit}>{location.commit.slice(0, 12)}</code>}</span>
  </div>;
}

export function HandoffSources({ handoff, open, busy }) {
  const sources = handoff.sources ?? [{ session: handoff.source, messages: [] }];
  return <div className="thread-handoff-origin" aria-label="Chat sources">
    {sources.map(({ session, messages }) => <section className="thread-actions" key={session.provider + ":" + session.id}>
      <button type="button" className="button small" disabled={busy} onClick={() => open(session)}>
        <Brand agent={session.provider} size={16} />{agentNames[session.provider]} · {session.title}
      </button>
      {messages.length > 0 && <details className="thread-handoff-source">
        <summary>Included messages · {messages.length}</summary>
        {messages.map(({ role, text }, index) => <blockquote key={index}>
          <strong>{role === "user" ? "You" : agentNames[session.provider]}</strong><p>{text}</p>
        </blockquote>)}
      </details>}
    </section>)}
  </div>;
}

const handoffModes = {
  "codex-review": "Codex · Review",
  codex: "Codex · Edit",
  claude: "Claude Code · Review",
  "claude-write": "Claude Code · Edit",
};

export function NativeChat({ preview, job, busy, ready, error, initialDraft, keepDraft, older, sendChat, refresh,
  transfer, openProject, restore, rename, back, sendOnEnter, api, choosePermission, chooseModels }) {
  const { session, chat, messages, hasOlder, skipped, sourceTaskId, delivered } = preview;
  const name = agentNames[session.provider];
  const [draft, setDraft] = useState(initialDraft);
  const draftValue = useRef(initialDraft);
  const draftEdits = useRef(0);
  const submittedDraft = useRef(chat?.pending && { requestId: chat.pending.requestId, edits: 0 });
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [pending, setPending] = useState(chat?.pending?.prompt ?? "");
  const turn = useRef(chat?.pending?.requestId ?? null);
  const [activity, setActivity] = useState(() => (chat?.pending?.events ?? []).reduce(nativeChatEvent,
    { windowTitle: chat?.pending?.window?.title, windowEnded: chat?.pending?.window?.ended }));
  const [responding, setResponding] = useState(false);
  const [controlError, setControlError] = useState("");
  const [savingModels, setSavingModels] = useState(false);
  const feed = useRef(null);
  const input = useRef(null);
  const search = useRef(null);
  const follow = useRef(true);
  const readOnly = Boolean(sourceTaskId || session.archived);
  const attachments = useNativeAttachments({ api, session, busy: busy || Boolean(pending) || readOnly,
    onEdited: () => { draftEdits.current++; keepDraft(draftValue.current); },
    canEdit: Boolean(chat?.permissionMode && chat.permissionMode !== "chat"),
    onDelivered: (text) => clearSentDraft(text, draftEdits.current) });
  const canSend = !readOnly && ready && chat?.available && !chat.active && !chat.unverified && !savingModels;
  const term = query.trim().toLocaleLowerCase();
  const visible = messages?.filter(({ text }) => !term || text.toLocaleLowerCase().includes(term)).reverse();

  const refreshAfterTurn = useEffectEvent(refresh);
  const restorePendingTurn = useEffectEvent(() => {
    const saved = chat?.pending;
    if (saved?.requestId && saved.requestId !== turn.current) {
      turn.current = saved.requestId;
      submittedDraft.current = { requestId: saved.requestId, edits: 0 };
      setPending(saved.prompt);
      setActivity((saved.events ?? []).reduce(nativeChatEvent, { windowTitle: saved.window?.title, windowEnded: saved.window?.ended }));
    } else if (chat && !saved && !chat.active && !sending.current) {
      turn.current = null;
      setPending("");
    }
  });
  useEffect(() => { restorePendingTurn(); }, [chat?.pending?.requestId, chat?.active]);
  useEffect(() => api.onEvent((data) => {
    if (data.type !== "native-chat-event" || data.provider !== session.provider || data.sessionId !== session.id || data.requestId !== turn.current) return;
    setActivity((current) => nativeChatEvent(current, data.event));
    if (data.event.type === "finished") { setPending(""); turn.current = null; void refreshAfterTurn(); }
  }), [api, session.provider, session.id]);

  async function control(command, payload = {}) {
    if (responding || !turn.current) return;
    setResponding(true);
    setControlError("");
    try {
      const result = await api[command]({ provider: session.provider, id: session.id, requestId: turn.current, ...payload });
      if (result?.cancelledBeforeStart) {
        turn.current = null; setPending("");
        setActivity((current) => ({ ...nativeChatEvent(current, { type: "finished" }), cancelled: true }));
        void refreshAfterTurn();
      }
    } catch (reason) { setControlError(String(reason.message ?? reason)); }
    finally { setResponding(false); }
  }

  useEffect(() => {
    if (canSend && !busy && !searching && follow.current) input.current?.focus({ preventScroll: true });
  }, [canSend, busy, searching]);

  useEffect(() => {
    if (searching) search.current?.focus({ preventScroll: true });
  }, [searching]);

  function clearSentDraft(prompt, edits) {
    if (draftValue.current.trim() !== prompt || draftEdits.current !== edits) return;
    draftValue.current = "";
    setDraft("");
    keepDraft("");
  }
  const clearDeliveredDraft = useEffectEvent((delivery) => {
    if (delivery.discardDraft === false) return;
    const submitted = submittedDraft.current;
    clearSentDraft(delivery.prompt, submitted?.requestId === delivery.requestId ? submitted.edits : 0);
  });
  useEffect(() => {
    if (delivered) clearDeliveredDraft(delivered);
  }, [delivered]);
  useEffect(() => { attachments.delivered(messages); }, [messages]);

  useLayoutEffect(() => {
    if (follow.current && !term && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [pending, messages, term, activity]);

  async function send(event) {
    event.preventDefault();
    const text = draft.trim() || (attachments.images.length ? "Describe the attached files and images." : "");
    if (!text || busy || sending.current || !canSend) return;
    if (!draft.trim()) { draftValue.current = text; setDraft(text); keepDraft(text); }
    sending.current = true;
    follow.current = true;
    setSearching(false);
    setQuery("");
    setPending(text);
    turn.current = crypto.randomUUID();
    const edits = draftEdits.current;
    submittedDraft.current = { requestId: turn.current, edits };
    setActivity({});
    setControlError("");
    try {
      if (attachments.images.length) attachments.begin(turn.current, text);
      if (await sendChat(text, chat.revision, { requestId: turn.current, permissionMode: chat.permissionMode ?? "chat", modelStamp: chat.modelStamp,
        images: attachments.images, computerToken: attachments.shared?.token }) && mounted.current) {
        clearSentDraft(text, edits);
      }
    } catch (reason) { if (mounted.current) setControlError(String(reason.message ?? reason)); }
    finally {
      attachments.revoke();
      sending.current = false;
      if (mounted.current) { turn.current = null; setPending(""); }
    }
  }

  const hint = busy && !messages ? "Loading original chat…" : session.archived ? "Restore this chat to continue it."
    : sourceTaskId ? "Original chat · Read only" : !chat ? "Refresh to verify this chat."
    : chat.unverified ? "Refresh messages before sending."
      : !chat.available ? "The recorded folder is unavailable. Restore it to continue this chat."
        : delivered?.status === "saved" ? "Message saved in the original chat. Refresh to check for a reply."
        : activity.cancelled ? "Waiting message cancelled. Your draft is kept."
        : chat.active ? "The original chat is working. Refresh when it finishes."
          : !ready ? name + " needs a connection and available usage."
            : preview.outcome?.status === "interrupted" ? "Stopped. Refresh to check the original chat before retrying."
            : preview.outcome?.error ? preview.outcome.error
            : "Replies are saved in the original chat. " + (chat.permissionMode === "chat" || !chat.permissionMode ? "Chat only." : "Files and commands enabled.");
  return <section className="thread-main deck-native-chat" aria-label={name + " original chat"}>
    <div>
    <header className="thread-taskbar">
      <div className="thread-title">
        <div className={"thread-session-provider " + session.provider}><Brand agent={session.provider} size={15} />
          {name} · Original chat</div>
        <h1 title={session.title}>{session.title}</h1>
      </div>
      <div className="thread-actions">
        <button className="button small" type="button" onClick={back}>Back to workspace</button>
        <button className="icon-button" type="button" aria-label="Refresh messages" title="Refresh messages"
          disabled={busy} onClick={refresh}><IconRefresh size={16} /></button>
        <ControlPopover className="deck-native-actions" title="Chat actions" label="Chat actions" icon={<IconDots size={15} />}>
          {!readOnly && <button className="button small" type="button" disabled={busy || Boolean(pending)} onClick={rename}>Rename</button>}
          <button className="button small" type="button" disabled={!messages} onClick={() => setSearching(true)}>Search in chat</button>
          {!readOnly && <>
            <button className="button small" type="button" disabled={busy || !messages} onClick={() => transfer("fork")}>Fork to Team</button>
            <button className="button small" type="button" disabled={busy || !messages?.length} onClick={() => transfer("handoff")}>Hand off messages</button>
            <button className="button small" type="button" disabled={busy} onClick={openProject}>Work with project files</button>
          </>}
          {session.archived && <button className="button small" type="button" disabled={busy} onClick={restore}>Manage archived chat</button>}
        </ControlPopover>
      </div>
    </header>
    {searching && <div className="deck-native-search">
      <input className="thread-search" ref={search} type="search" aria-label="Search in this chat" placeholder="Search in this chat…"
        maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Escape") { setSearching(false); setQuery(""); }
          if (event.key === "Enter" && term && hasOlder && !busy && !event.nativeEvent.isComposing) void older(term);
        }} />
      <span className="setting-detail" role="status">{term && (visible?.length ?? 0) + " matches"}</span>
      <button className="button small" type="button" onClick={() => { setSearching(false); setQuery(""); }}>Close search</button>
    </div>}
    </div>
    <div className="thread-feed thread-chat-feed deck-native-feed" ref={feed} aria-label="Original chat messages"
      onScroll={(event) => { const el = event.currentTarget; follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 48; }}>
      {hasOlder && <button className="button small deck-native-older" type="button" disabled={busy}
        onClick={() => { follow.current = false; void older(term); }}>{term ? "Search older messages" : "Load older messages"}</button>}
      {skipped && <p className="setting-detail">Some very large transcript records were skipped.</p>}
      {visible?.length === 0 && <p className="setting-detail">{term ? "No matches in loaded messages." : "No readable messages in this chat."}</p>}
      {visible?.map(({ id, role, text, images, at }, index) => role === "user"
        ? <div className="deck-native-turn" key={id}><ChatTimestamp at={at} previousAt={visible[index - 1]?.at} everyTurn />
          <article className="thread-prompt" aria-label="You"><div className="thread-prompt-body"><p>{text}</p>
          <ImageChips images={images} preview={attachments.preview} /></div></article></div>
        : <article className="deck-native-reply" key={id}>
          <div className="thread-session-provider"><Brand agent={session.provider} size={16} /><strong>{name}</strong></div>
          <ChatMarkdown text={text} />
        </article>)}
      {activity.steps?.length > 0 && <details className="deck-native-work">
        <summary>{activity.steps.length} work steps · {commandSummary(activity.steps.at(-1).text)}</summary>
        {activity.steps.map((step) => <details key={step.key}><summary>{commandSummary(step.text)}</summary><pre>{step.text}</pre></details>)}
      </details>}
      {activity.controls?.map((row) => row.type === "question"
        ? <QuestionCard key={row.key} row={{ ...row, agent: session.provider }} busy={responding || !pending}
          answer={(item, answers) => control("native-chat-answer", { key: item.key, answers })} />
        : <article key={row.key} className="thread-event thread-approval">
          <IconShieldCheck size={19} /><div><strong>{name} · {row.title}</strong>
            {row.note && <p className="setting-detail">{row.note}</p>}<pre>{row.text}</pre>
            {row.decision ? <span>{row.decision}</span> : <div className="thread-actions">
              <button className="button small" type="button" disabled={responding || !pending}
                onClick={() => control("native-chat-approve", { key: row.key, accept: false })}>Decline</button>
              <button className="button primary small" type="button" disabled={responding || !pending}
                onClick={() => control("native-chat-approve", { key: row.key, accept: true })}>Approve once</button>
            </div>}
          </div>
        </article>)}
      {pending && <p className="setting-detail" role="status">{job?.state === "waiting" ? job.reason : (activity.stopping ? "Stopping " : "Working with ") + name + "…"}</p>}
    </div>
    <div className="thread-compose-wrap">
      {error && <p className="live-error" role="alert">{error}</p>}
      {controlError && <p className="live-error" role="alert">{controlError}</p>}
      {attachments.error && <p className="live-error" role="alert">{attachments.error}</p>}
      {!readOnly && <form className="thread-composer" onSubmit={send} onDrop={attachments.drop} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}>
        <ComposerAttachments images={attachments.images} thumbnail={attachments.thumbnail} preview={attachments.preview} remove={attachments.remove} busy={busy || Boolean(pending) || attachments.adding} />
        {attachments.adding && <p className="setting-detail" role="status">{attachments.progress || "Adding files. Scanned documents use local OCR…"}</p>}
        {attachments.shared && !pending && <div className="thread-actions" role="status"><span className="setting-detail">Window shared for next turn · {attachments.shared.title}</span>
          <button type="button" className="button small" onClick={attachments.revoke}>Stop sharing</button></div>}
        {pending && activity.windowTitle && <div className="thread-actions" role="status"><span className="setting-detail">
          {activity.windowEnded ? "Window access ended" : "Window shared"} · {activity.windowTitle}</span>
          {!activity.windowEnded && <button type="button" className="button small" disabled={responding}
            onClick={() => control("native-chat-unshare")}>Stop sharing</button>}</div>}
        <textarea ref={input} value={draft} onChange={(event) => {
          draftEdits.current++; attachments.edited();
          draftValue.current = event.target.value;
          setDraft(event.target.value); keepDraft(event.target.value);
        }}
          rows={1} maxLength={18000} aria-label="Message in original chat" placeholder={"Message " + name + "…"} readOnly={Boolean(pending)}
          onPaste={attachments.paste} onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229 ||
                !(sendOnEnter || event.ctrlKey)) return;
            event.preventDefault();
            if (!event.repeat) event.currentTarget.form.requestSubmit();
          }} />
        <div className="thread-compose-actions deck-native-compose-actions">
          <div className="thread-actions deck-native-compose-settings">{attachments.controls}<span className="thread-session-provider"><Brand agent={session.provider} size={15} />{name}</span>
            <PermissionPicker mode={chat?.permissionMode ?? "chat"} choices={nativePermissionModes} busy={busy || Boolean(pending)}
              unavailable={!chat?.available || chat.active || chat.unverified ? "Refresh to verify this chat's folder before changing permissions." : undefined}
              scope={"Saved for this original chat. Folder: " + (chat?.cwd ?? session.cwd ?? "Unavailable")}
              choose={choosePermission} />
            <NativeModelPicker provider={session.provider} chat={chat} busy={busy || Boolean(pending)} api={api}
              save={chooseModels} onSaving={setSavingModels} />
          </div>
          <div className="thread-actions deck-native-compose-submit">{pending && <button className="button small" type="button"
            disabled={responding || activity.stopping} onClick={() => control("native-chat-stop")}><IconPlayerStop size={15} />Stop</button>}
          <button className="button primary small" type="submit"
            disabled={busy || attachments.adding || !canSend || !draft.trim() && !attachments.images.length}>Send<IconArrowUp size={15} /></button></div>
        </div>
      </form>}
      {attachments.dialog}
      <p className="thread-hint" role="status">{pending ? "Sending to " + name + "…" : hint}</p>
    </div>
  </section>;
}

export function NativeChatTransfer({ preview, older, busy, repositories, recents = [], pullSessions, chooseRepo, action, create }) {
  const { session, kind } = preview;
  const [picked, setPicked] = useState(new Set());
  const [query, setQuery] = useState("");
  const [handoff, setHandoff] = useState(false);
  const [forkWithProject, setForkWithProject] = useState(false);
  const [includeRecent, setIncludeRecent] = useState(true);
  const [repo, setRepo] = useState("");
  const [mode, setMode] = useState(session.provider === "codex" ? "claude" : "codex-review");
  const [builder, setBuilder] = useState(session.provider);
  const [instruction, setInstruction] = useState("");
  const [check, setCheck] = useState(null);
  const [checkError, setCheckError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [runChecks, setRunChecks] = useState(false);
  const [other, setOther] = useState(null);
  const [otherPicked, setOtherPicked] = useState(new Set());
  const [showOther, setShowOther] = useState(false);
  const checkedOnOpen = useRef(false);
  const team = kind === "fork";
  const chatOnly = team && !forkWithProject;
  const MessagePanel = team ? "details" : "div";
  const secondary = team && showOther && other;
  const { messages, hasOlder, skipped } = secondary || preview;
  const shownAgent = secondary ? other.session.provider : session.provider;
  const reviewer = builder === "codex" ? "claude" : "codex";
  const runMode = team ? (builder === "codex" ? "build-review" : "claude-build-review") : mode;
  const term = query.trim().toLocaleLowerCase();
  const chronological = messages ? [...messages].reverse() : [];
  const visible = chronological.filter(({ text }) => !term || text.toLocaleLowerCase().includes(term));
  const chosen = [...(preview.messages ?? [])].reverse().filter(({ id }) => picked.has(id));
  const otherChosen = team ? [...(other?.messages ?? [])].reverse().filter(({ id }) => otherPicked.has(id)) : [];
  const count = chosen.length + otherChosen.length;
  const total = [...chosen, ...otherChosen].reduce((sum, { text }) => sum + text.length + 14, 0);
  const needsConfirmation = check && (check.comparison.repo !== "same" || check.comparison.branch === "different");
  const overLimit = count > 32 || total + (team ? 0 : instruction.length) >= 17800;
  const canContinue = (team || count > 0) && !overLimit;
  const receiver = mode.startsWith("codex") ? "Codex" : "Claude Code";
  const editMode = team || ["codex", "claude-write"].includes(mode);
  const choices = [...new Set([repo, ...repositories.filter((item) => !item.chatOnly).map((item) => item.repo)].filter(Boolean))];
  const recent = chatOnly && includeRecent && !count ? recentForkMessages(preview.messages) : [];
  const additional = otherChosen.length > 0 ? { provider: other.session.provider, id: other.session.id, messages: otherChosen } : undefined;

  function toggle(id) {
    (secondary ? setOtherPicked : setPicked)((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function selectOther(id) {
    const next = recents.find((item) => item.id === id && item.provider !== session.provider);
    if (!next) {
      setOther(null);
      setOtherPicked(new Set());
      setShowOther(false);
      return;
    }
    const result = await action("native-session-preview", { provider: next.provider, id: next.id });
    if (!result) return;
    setOther({ session: next, ...result });
    setOtherPicked(new Set());
    setQuery("");
    setShowOther(true);
  }

  async function loadOlder() {
    if (!secondary) return older(term);
    const { provider, id } = other.session;
    const page = await action("native-session-preview", { provider, id, older: true, query: term });
    if (!page) return;
    setOther((current) => {
      if (current?.session.id !== id) return current;
      const loaded = new Set(current.messages.map((message) => message.id));
      return { ...current, ...page, skipped: current.skipped || page.skipped,
        messages: [...current.messages, ...page.messages.filter((message) => !loaded.has(message.id))] };
    });
  }

  async function verify(nextRepo) {
    setCheck(null);
    setCheckError("");
    setConfirmed(false);
    const result = await action("native-handoff-check", { provider: session.provider, id: session.id, repo: nextRepo }, setCheckError);
    if (result) {
      setRepo(result.repo);
      setCheck(result);
    }
  }

  const verifyTeamDestination = useEffectEvent(() => { void verify(repo); });
  useEffect(() => {
    if (!team || chatOnly) checkedOnOpen.current = false;
    else if (!busy && !checkedOnOpen.current) {
      checkedOnOpen.current = true;
      verifyTeamDestination();
    }
  }, [team, chatOnly, busy]);

  function continueWithSelection() {
    setHandoff(true);
    void verify(repo);
  }

  return <div className="thread-session-preview">
    <p className={"thread-session-provider " + session.provider}>
      <Brand agent={session.provider} size={17} /><strong>{agentNames[session.provider]}</strong><span>· {session.title}</span>
    </p>
    <div>
    {(team || handoff) && <div className="thread-handoff-form">
      {!team && <div className="thread-session-heading">
        <button className="button small" type="button" disabled={busy} onClick={() => setHandoff(false)}>Back to selection</button>
        <span className="setting-detail">{count} selected · opens a draft</span>
      </div>}
      {team && <label className="field"><strong>What will the team do?</strong>
        <select value={forkWithProject ? "project" : "chat"} disabled={busy} onChange={(event) => setForkWithProject(event.target.value === "project")}>
          <option value="chat">Chat only</option>
          <option value="project">Work in a project</option>
        </select>
      </label>}
      {chatOnly ? <>
        <p className="setting-detail">Continue the conversation with Codex and Claude Code. No project or Git required.</p>
        {count === 0 && <label className="thread-handoff-confirm">
          <input type="checkbox" checked={includeRecent} disabled={busy} onChange={(event) => setIncludeRecent(event.target.checked)} />
          Include up to 6 recent messages from this chat
        </label>}
        <button className="button small primary" type="button" disabled={busy || overLimit} onClick={() =>
          create({ provider: session.provider, id: session.id, mode: discussionMode, messages: count ? chosen : recent, additional })}>
          Create team chat
        </button>
      </> : <>
      {team && <p className="setting-detail">Choose the project where the team will work when you ask it to edit files.</p>}
      <div className="thread-handoff-fields">
        {team ? <>
          <label className="field"><strong>Builder</strong>
            <select value={builder} disabled={busy} onChange={(event) => setBuilder(event.target.value)}>
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
            </select>
          </label>
          <div className="field"><strong>Reviewer</strong>
            <span className="thread-session-provider"><Brand agent={reviewer} size={16} />{agentNames[reviewer]}</span>
          </div>
        </> : <label className="field"><strong>Receiving agent</strong>
          <select value={mode} disabled={busy} onChange={(event) => setMode(event.target.value)}>
            {Object.entries(handoffModes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>}
        <label className={team ? "field thread-team-fork-project" : "field"}><strong>Destination {team ? "project" : "repository"}</strong>
          <select value={repo} disabled={busy} onChange={(event) => {
            setRepo(event.target.value);
            void verify(event.target.value);
          }}>
            <option value="">{team ? "Choose a project" : "Find from this chat"}</option>
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
        <button className="button small" type="button" disabled={busy} onClick={() => verify(repo)}>{check ? "Recheck repo & branch" : "Check repo & branch"}</button>
        {!check && busy && <span role="status">Checking repo and branch…</span>}
      </div>
      {checkError && <p className="setting-detail" role="alert">{checkError}</p>}
      {check && <>
        <HandoffLocation label="Verified destination" location={check.target} />
        {!team && (check.source.repo || check.source.branch || check.source.folder) && <details className="thread-handoff-source" open={needsConfirmation || undefined}>
          <summary>Original chat location</summary>
          <HandoffLocation label="Source session · recorded branch" location={check.source} />
          {check.source.folder && check.source.folder !== check.source.repo && <p className="setting-detail">Recorded folder · {check.source.folder}</p>}
        </details>}
        {!team && check.comparison.repo !== "same" && <p className="setting-detail" role="status">
          {check.comparison.repo === "different" ? "Source and destination are different repositories." : "The source repository could not be verified."}
        </p>}
        {!team && check.comparison.branch !== "same" && <p className="setting-detail" role="status">
          {check.comparison.branch === "different" ? "Source and destination branches differ." : "The source session has no recorded branch."}
        </p>}
        {!team && needsConfirmation && <label className="thread-handoff-confirm">
          <input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
          Use this destination for the handoff
        </label>}
        {!team && <label className="field"><strong>What should the agent do?</strong>
          <textarea value={instruction} disabled={busy} rows={2} maxLength={4000}
            onChange={(event) => setInstruction(event.target.value)} placeholder="Review the selected plan and flag risks." />
        </label>}
        {check.readOnly && editMode && <p className="setting-detail" role="status">{team
          ? "This project is read-only. Choose an editable destination." : "This project is read-only. Choose a review mode."}</p>}
        {team && check.requiredChecks > 0 && <label className="thread-handoff-confirm">
          <input type="checkbox" checked={runChecks} disabled={busy} onChange={(event) => setRunChecks(event.target.checked)} />
          Run approved project checks before review when evidence is missing
        </label>}
        <button className="button small primary" type="button" disabled={busy || !canContinue ||
          (!team && (!instruction.trim() || needsConfirmation && !confirmed)) || (check.readOnly && editMode)} onClick={() =>
          create({ provider: session.provider, id: session.id, mode: runMode, messages: chosen, repo: check.repo, checked: check.target,
            ...(team ? { confirmed: true, runChecks, additional }
              : { confirmed, instruction }) })}>
          {team ? "Create project chat" : `Draft for ${receiver} on ${check.target.branch || "detached HEAD"}`}
        </button>
      </>}
      </>}
    </div>}
    {!handoff && <MessagePanel className={team ? "thread-fork-excerpts" : undefined}>
    {team && <summary>Attach messages (optional){count > 0 ? " · " + count + " selected" : ""}</summary>}
    <section className={team ? "thread-team-fork-messages" : undefined} aria-label="Source chat messages">
      {team && <>
        <p className="setting-detail">{chatOnly ? "Pick exact messages to use as context instead of the recent messages." : "Selected messages will be included as context on the first send."}</p>
        <label className="field"><strong>Add context from Recents</strong>
          <select aria-label="Add context from Recents" value={other?.session.id ?? ""} disabled={busy}
            onChange={(event) => void selectOther(event.target.value)}>
            <option value="">Choose a chat from {agentNames[session.provider === "codex" ? "claude" : "codex"]}</option>
            {recents.filter((item) => item.provider !== session.provider).map((item) =>
              <option key={item.id} value={item.id}>{item.title}{item.project ? " · " + item.project : ""}</option>)}
          </select>
        </label>
        {!recents.some((item) => item.provider !== session.provider) && <button className="button small" type="button" disabled={busy}
          onClick={pullSessions}>Pull sessions</button>}
        {other && <div className="thread-actions" aria-label="Chat sources">
          <button className="button small" aria-pressed={!showOther} disabled={busy}
            onClick={() => { setShowOther(false); setQuery(""); }}>{agentNames[session.provider]} · {chosen.length}</button>
          <button className="button small" aria-pressed={showOther} disabled={busy}
            onClick={() => { setShowOther(true); setQuery(""); }}>{agentNames[other.session.provider]} · {otherChosen.length}</button>
        </div>}
        {count > 0 && <details className="thread-handoff-source">
          <summary>Preview selected context · {count}</summary>
          {[{ name: agentNames[session.provider], rows: chosen }, { name: other && agentNames[other.session.provider], rows: otherChosen }]
            .filter(({ rows }) => rows.length > 0).map(({ name, rows }) => <section key={name}>
              <strong>{name}</strong>{rows.map(({ id, text }) => <article key={id}><p>{text}</p></article>)}
            </section>)}
        </details>}
      </>}
      {!messages && busy && <p role="status">Loading session…</p>}
      {messages && <>
        <div className="thread-session-controls">
          <input className="thread-search" type="search" aria-label="Search in this chat" placeholder="Search in this chat…" maxLength={200}
            value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && term && hasOlder && !busy && !event.nativeEvent.isComposing) void loadOlder();
            }} />
          <div className="thread-actions">
            <span role="status">{count ? `${count} selected` : team ? "Select messages to include." : "Select messages to hand off."}
              {term && ` · ${visible.length} matches${hasOlder ? " in loaded messages" : ""}`}</span>
            {!team && <button className="button small primary" type="button" disabled={busy || !canContinue}
              onClick={continueWithSelection}>Continue with selection</button>}
          </div>
          {overLimit && <p className="setting-detail">Select fewer messages to fit the draft.</p>}
        </div>
        {hasOlder && <button className="button small" type="button" disabled={busy} onClick={loadOlder}>
          {busy ? "Loading…" : term ? "Search older messages" : "Load older messages"}
        </button>}
        {skipped && <p className="setting-detail">Some very large transcript records were skipped.</p>}
        {!visible.length && <p className="setting-detail">{term ? "No matches in loaded messages." : "No readable messages in this page."}</p>}
        {visible.map(({ id, role, text, clipped }, index) => <article key={id} className={role}>
          <label className="thread-message-pick">
            <input type="checkbox" aria-label={`Select message ${index + 1} from ${role === "user" ? "you" : agentNames[shownAgent]}`}
              disabled={clipped || text.length >= 18000} checked={(secondary ? otherPicked : picked).has(id)} onChange={() => toggle(id)} />
            <strong>{role === "user" ? "You" : agentNames[shownAgent]}</strong>
          </label>
          <p>{text}</p>
          {(clipped || text.length >= 18000) && <p className="setting-detail">This message is too long to forward in one draft.</p>}
        </article>)}
      </>}
    </section></MessagePanel>}
    </div>
  </div>;
}
