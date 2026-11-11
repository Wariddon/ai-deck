import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowRight, IconChevronRight, IconFileText, IconFolder, IconGitBranch, IconMessage, IconPhoto, IconPin, IconPlus, IconRefresh, IconTrash,
  IconCheck, IconChevronDown, IconClock, IconHandStop, IconHistory, IconShieldCheck, IconShieldExclamation, IconTerminal2, IconX,
} from "@tabler/icons-react";
import { AgentMark, Brand } from "./AgentIdentity.jsx";
import { runModelProfile } from "../desktop/agent-settings.mjs";
import { autoTeamPlanNeedsBaseCheck, routeMode } from "../desktop/usage-routing.mjs";
import { maxSessionSelection, sessionKey } from "../desktop/session-selection.mjs";
import { sessionTeamMode } from "../desktop/session-team.mjs";
import { agentRole, separateEdits, steerableDraft } from "../desktop/collaboration.mjs";
import { SessionButton } from "./SessionTools.jsx";
import { AutoTeamAssignments, TeamAnswerPreview, TeamHandoffs, TeamRunResult } from "./TeamHandoff.jsx";
import { commandSummary, groupWorkActivity } from "./command-activity.mjs";
import { OnDemandDetails, WorkSteps } from "./WorkActivity.jsx";
import { conversationTurns } from "./timeline-rows.mjs";
import { ControlPopover } from "./ControlPopover.jsx";
import { RunReceipt } from "./RunReceipt.jsx";
import { ChatTurnRail } from "./ChatNavigation.jsx";
import { ChatMarkdown } from "./ChatMarkdown.jsx";

export const agentNames = { codex: "Codex", claude: "Claude Code" };
export { Brand };

const permissions = {
  chat: { label: "Chat only", icon: IconMessage, description: "Continue the original chat without file or command tools." },
  ask: { label: "Ask for approval", icon: IconHandStop, description: "Show approval cards for actions that need permission." },
  auto: { label: "Approve for me", icon: IconShieldCheck, description: "Use Codex or Claude Code’s automatic reviewer where available." },
  full: { label: "Full access", icon: IconShieldExclamation, description: "Let the writer use files and the internet with your Windows account access." },
};

export function PermissionPicker({ mode, choices = ["ask", "auto", "full"], unavailable, restriction, scope, busy, working, choose, learn }) {
  const selected = choices.includes(mode) ? mode : choices[0];
  const SelectedIcon = permissions[selected].icon;
  return <div className="thread-permission-picker" data-permission={unavailable || restriction ? undefined : selected}>
    <ControlPopover title={"Change permissions · " + permissions[selected].label} label={unavailable || restriction ? "Permissions" : permissions[selected].label}
      className="thread-permissions-menu" icon={<SelectedIcon size={15} />}>
      <div className="thread-permissions-heading"><span>How should agent actions be approved?</span>
        {learn && <button type="button" className="thread-text-button" onClick={learn}>Learn more</button>}</div>
      {choices.map((key) => {
        const { label, icon: Icon, description } = permissions[key];
        return <button key={key} type="button" className="button thread-permission-option" data-permission={key}
          disabled={busy || Boolean(unavailable)} aria-pressed={selected === key} onClick={() => { if (selected !== key) choose(key); }}>
          <Icon size={17} /><span><strong>{label}</strong><small>{description}</small></span>
          {selected === key && <IconCheck size={16} />}
        </button>;
      })}
      <p>{unavailable || restriction || (working ? "Saved for the next run. This run keeps its permissions."
        : scope || "Saved for this task. Applies to the writer on the next run.")}</p>
    </ControlPopover>
  </div>;
}

export const modeNames = {
  "auto-team": "Auto Team",
  "session-team": "Session Team",
  "team-discussion": "Discuss together · no edits",
  "parallel-checks": "Team · Independent checks",
  "build-review": "Codex builds → Claude reviews", "claude-build-review": "Claude builds → Codex reviews", team: "Parallel · review starting snapshot", "claude-team": "Parallel · Claude leads, review starting snapshot",
  "claude-plan-codex": "Claude plans → Codex implements", "codex-plan-claude": "Codex plans → Claude implements",
  "parallel-write": "Team · Separate edits", "claude-parallel-write": "Separate edits · Claude leads", codex: "Codex", "codex-review": "Codex · Review", "codex-plan": "Codex · Plan", claude: "Claude · Review", "claude-plan": "Claude · Plan", "claude-write": "Claude · Edit",
};
export function modeLabel(mode, lowMemory) {
  if (lowMemory && mode === "team") return "Codex first · review starting snapshot";
  if (lowMemory && mode === "claude-team") return "Claude first · review starting snapshot";
  if (lowMemory && mode === "claude-parallel-write") return "Separate edits · Claude first";
  return modeNames[mode];
}

const roleTitle = { plan: "Plan", review: "Review", write: "Implement" };

export function AssignmentEvidence({ mode, teamwork, planner = teamwork?.planner, label = "Role assignment", lowMemory, open = false }) {
  const agents = mode === "auto-team" && planner === "claude" ? ["claude", "codex"] : routeMode(mode, {}).requested;
  if (!agents.length) return null;
  return <details className="deck-assignment-evidence" open={open || undefined}>
    <summary>{label} · {modeLabel(mode, lowMemory)}</summary>
    <div className="deck-assignment-content">
      {agents.map((agent, index) => <div key={agent}>
        <strong>{agentNames[agent]} · {mode === "auto-team" ? index ? "Check & assign" : "Propose" : roleTitle[agentRole(mode, agent)]}</strong>
        <p>{teamwork?.[agent] || "Uses the task prompt."}</p>
        {separateEdits(mode) && teamwork?.[agent + "Paths"] && <p className="setting-detail">Write paths · {teamwork[agent + "Paths"].split(/\r?\n/u).join(", ")}</p>}
      </div>)}
      {teamwork?.brief && <p><strong>Shared brief</strong> {teamwork.brief}</p>}
      {teamwork?.outcome && <p><strong>Done when / handoff</strong> {teamwork.outcome}</p>}
    </div>
  </details>;
}

export const projectName = (repo) => repo.split(/[\\/]/u).at(-1);

export function Sidebar({ repositories, workspace, busy, jobs = [], openRepo, openTask, newTask, nativeRecents, currentNative, pins, pullSessions, openNativeChat, pinSession, manageSession,
  selection, setSelection, reviewDeletion, hidden, backToChat }) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const [archived, setArchived] = useState(false);
  const selectionAnchor = useRef(null);
  const term = query.trim().toLocaleLowerCase();
  const matches = (task, repo) => Boolean(task.archived) === archived && (!term || `${task.title} ${projectName(repo)}`.toLocaleLowerCase().includes(term));
  const recent = repositories.filter((project) => archived || project.repo !== workspace?.repo)
    .flatMap((project) => project.tasks.filter((task) => matches(task, project.repo)).map((task) => ({ ...task, repo: project.repo })))
    .sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? "")).slice(0, term ? 30 : 8);
  const { sessions, errors, loading, pulled, error } = nativeRecents;
  const key = (session) => session.provider + ":" + session.id;
  const pulledSessions = new Map(sessions.map((session) => [key(session), session]));
  const pinned = new Set(pins.map(key));
  const matchesSession = (session) => Boolean(session.archived) === archived && (provider === "all" || session.provider === provider) &&
    (!term || `${session.title} ${session.project} ${agentNames[session.provider]}`.toLocaleLowerCase().includes(term));
  const favorites = pins.map((session) => pulledSessions.get(key(session)) ?? session).filter(matchesSession);
  const external = sessions.filter((session) => !pinned.has(key(session)) && matchesSession(session));
  const visible = expanded || term ? external : external.slice(0, 8);
  const shown = [...favorites, ...visible, ...recent];
  const allShownSelected = shown.length > 0 && shown.every((entry) => selection?.has(sessionKey(entry)));
  const hiddenSelections = (selection?.size ?? 0) - shown.filter((entry) => selection?.has(sessionKey(entry))).length;
  function selectEntries(entries, checked) {
    setSelection((current) => {
      if (!current) return current;
      const next = new Map(current);
      for (const entry of entries) {
        const key = sessionKey(entry);
        if (!checked) next.delete(key);
        else if (next.size < maxSessionSelection) next.set(key, entry);
      }
      return next;
    });
  }
  function selectRow(entry, event) {
    const key = sessionKey(entry);
    const from = event.nativeEvent.shiftKey ? shown.findIndex((item) => sessionKey(item) === selectionAnchor.current) : -1;
    const to = shown.findIndex((item) => sessionKey(item) === key);
    selectionAnchor.current = key;
    selectEntries(from < 0 || to < 0 ? [entry] : shown.slice(Math.min(from, to), Math.max(from, to) + 1), event.target.checked);
  }
  const selectableRow = (entry, brand) => <label className="thread-side-row thread-native-row thread-select-row" title={entry.title}>
    <input type="checkbox" checked={selection.has(sessionKey(entry))} disabled={busy || selection.size >= maxSessionSelection && !selection.has(sessionKey(entry))}
      aria-label={"Select " + (agentNames[entry.provider] ?? "AI Deck") + ": " + entry.title} onChange={(event) => selectRow(entry, event)} />
    {brand}<span className="thread-native-title">{entry.title}</span>
  </label>;
  const sessionRow = (session) => {
    if (selection) return <div className="thread-native-entry" key={key(session)}>{selectableRow(session, <Brand agent={session.provider} size={15} />)}</div>;
    const isPinned = pinned.has(key(session));
    return <div className="thread-native-entry" key={key(session)}>
      <button className="thread-side-row thread-native-row" type="button" disabled={busy} aria-label={agentNames[session.provider] + ": " + session.title}
        aria-current={currentNative && key(currentNative) === key(session) ? "page" : undefined}
        title={[agentNames[session.provider], session.title, session.project, session.updatedAt ? new Date(session.updatedAt).toLocaleString() : ""].filter(Boolean).join(" · ")}
        onClick={() => openNativeChat(session)}>
        <Brand agent={session.provider} size={15} />
        <span className="thread-native-title">{session.title}</span>
        {jobs.some((job) => job.key === "native:" + session.provider + ":" + session.id) && <span className="thread-job-spinner" role="status" aria-label="Working" />}
      </button>
      <button className="icon-button thread-native-pin" type="button" disabled={busy} aria-pressed={isPinned}
        aria-label={(isPinned ? "Unpin " : "Pin ") + session.title} title={isPinned ? "Unpin session" : "Pin session"} onClick={() => pinSession(session)}><IconPin size={13} /></button>
      <SessionButton entry={session} busy={busy} manage={manageSession} />
    </div>;
  };
  const taskRow = (task, repo, project = false) => {
    const job = jobs.find((item) => item.taskId === task.id);
    const entry = { ...task, repo };
    if (selection && !project) return <div className="thread-native-entry" key={repo + ":" + task.id}>{selectableRow(entry, <IconMessage size={14} />)}</div>;
    return <div className="thread-native-entry" key={repo + ":" + task.id}>
      <button className={"thread-side-row thread-native-row" + (project ? " thread-task-row" : "")} type="button" disabled={busy}
        aria-current={!currentNative && workspace?.taskId === task.id ? "page" : undefined} title={[task.title, task.attention?.label].filter(Boolean).join(" · ")}
        onClick={() => archived ? manageSession(entry) : openTask(repo, task.id)}>
        <IconMessage size={14} /><span className="thread-native-title">{task.title}</span>
        {job && (job.state === "waiting" ? <IconClock size={14} className="thread-job-waiting" role="img" aria-label={job.reason} />
          : <span className="thread-job-spinner" role="status" aria-label={job.needsInput ? "Waiting for your input" : "Working"} data-input={job.needsInput || undefined} />)}
        {!job && task.attention && <IconClock className="thread-task-attention" size={13} role="img" aria-label={task.attention.label} />}
        {task.queued > 0 && <small>{task.queued}</small>}
      </button>
      <SessionButton entry={entry} busy={busy} manage={manageSession} />
    </div>;
  };
  return (
    <aside className="thread-sidebar" id="deck-project-sidebar" aria-label="Projects and recent sessions" hidden={hidden}>
      {backToChat && <div className="thread-panel-return"><strong>Projects and recent sessions</strong>
        <button className="button small" type="button" data-panel-back onClick={backToChat}>Back to chat</button>
      </div>}
      <button className="button thread-new" onClick={workspace ? newTask : openRepo} disabled={busy}><IconPlus size={17} />New task</button>
      <input type="search" className="thread-search" aria-label="Search tasks and sessions" placeholder="Find tasks or sessions…" value={query} onChange={(event) => setQuery(event.target.value)} />
      {selection && <div className="thread-bulk-toolbar" aria-label="Selected chats">
        <strong role="status">{selection.size} selected{hiddenSelections > 0 && " · " + hiddenSelections + " outside this view"}</strong>
        <div className="thread-recent-filters">
          <button className="button small" type="button" disabled={busy || !shown.length || !allShownSelected && selection.size >= maxSessionSelection}
            onClick={() => selectEntries(shown, !allShownSelected)}>{allShownSelected ? "Deselect shown" : "Select shown"}</button>
          <button className="button small" type="button" disabled={busy} onClick={() => { selectionAnchor.current = null; setSelection(null); }}>Cancel</button>
          <button className="button small thread-delete-button" type="button" disabled={busy || !selection.size}
            onClick={reviewDeletion}><IconTrash size={14} />Delete selected</button>
        </div>
      </div>}
      <div className="thread-side-heading"><span>{repositories.some((project) => project.chatOnly) ? "Projects and team chats" : "Projects"}</span><button className="icon-button" aria-label="Open repository" title="Open repository" disabled={busy} onClick={openRepo}><IconFolder size={17} /></button></div>
      {!repositories.length && <p className="thread-side-empty">Open a Git repo to start.</p>}
      {repositories.map((project) => {
        const current = workspace?.repo === project.repo;
        return (
          <div className="thread-project" key={project.repo}>
            <button className="thread-side-row" type="button" title={project.repo} disabled={busy || current} onClick={() => openTask(project.repo, project.currentTask)}>
              {project.chatOnly ? <IconMessage size={16} /> : <IconFolder size={16} />}<span>{projectName(project.repo)}</span><IconChevronRight size={12} />
            </button>
            {current && !archived && project.tasks.filter((task) => matches(task, project.repo)).map((task) => taskRow(task, project.repo, true))}
          </div>
        );
      })}
      <section className="thread-recents" aria-label="Recents">
        <div className="thread-side-heading">
          <ControlPopover className="deck-recents-panel" title="Recent chat controls"
            icon={loading ? <span className="deck-spinner" aria-hidden="true" /> : <IconHistory size={15} aria-hidden="true" />}
            label={(archived ? "Archived" : "Recents") + (provider === "all" ? "" : " · " + agentNames[provider])}>
            <div className="deck-control-label">Show chats</div>
            <div className="deck-control-options" role="group" aria-label="Session status">
              <button className="button small" type="button" aria-pressed={!archived} onClick={() => { setArchived(false); setExpanded(false); }}>Active</button>
              <button className="button small" type="button" aria-pressed={archived} onClick={() => { setArchived(true); setExpanded(false); }}>Archived</button>
            </div>
            {(pulled || pins.length > 0) && <>
              <div className="deck-control-label">Provider</div>
              <div className="deck-control-options" role="group" aria-label="Session provider">
                {Object.entries({ all: "All", codex: "Codex", claude: "Claude Code" }).map(([key, label]) =>
                  <button key={key} className="button small" type="button" aria-pressed={provider === key}
                    onClick={() => { setProvider(key); setExpanded(false); }}>{label}</button>)}
              </div>
              {pulled && <p className="thread-side-empty">{sessions.filter((session) => session.provider === "codex").length} Codex · {sessions.filter((session) => session.provider === "claude").length} Claude Code</p>}
            </>}
            <div className="deck-control-options deck-control-separator">
              <button className="button small" type="button" disabled={busy || loading} onClick={pullSessions}
                title="Read local Codex and Claude Code sessions"><IconRefresh size={14} />{loading ? "Pulling…" : "Pull sessions"}</button>
              {!selection && <button className="button small" type="button" disabled={busy || !shown.length}
                onClick={() => { selectionAnchor.current = null; setSelection(new Map()); }}>Select chats</button>}
            </div>
          </ControlPopover>
        </div>
        {loading && !sessions.length && <p className="thread-side-empty" role="status">Loading recent chats…</p>}
        {!pulled && !loading && !error && <p className="thread-side-empty">Recent chats refresh when the app is ready.</p>}
        {error && <p className="thread-side-empty" role="alert">{error}</p>}
        {(pulled || pins.length > 0) && <>
          {favorites.length > 0 && <>
            <div className="thread-side-heading">Pinned sessions</div>
            {favorites.map(sessionRow)}
          </>}
          {Object.entries(errors).map(([key, message]) => <p key={key} className="thread-side-empty" role="alert">{message}</p>)}
          {!external.length && !favorites.length && !loading && <p className="thread-side-empty">{term ? "No matching source sessions." : archived ? "No archived source sessions." : "No local sessions to show."}</p>}
          {favorites.length > 0 && visible.length > 0 && <div className="thread-side-heading">Recent sessions</div>}
          {visible.map(sessionRow)}
          {!term && external.length > 8 && <button className="thread-side-row thread-recent-more" type="button"
            aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show all ${external.length}`}</button>}
        </>}
        {recent.length > 0 && <>
          <div className="thread-side-heading">AI Deck tasks</div>
          {recent.map((task) => taskRow(task, task.repo))}
        </>}
      </section>
      {workspace?.base && <div className="thread-side-branch"><IconGitBranch size={15} /><code>{workspace.base.slice(0, 8)}</code></div>}
    </aside>
  );
}

export function QuestionCard({ row, busy, answer }) {
  const [selections, setSelections] = useState({});
  const [custom, setCustom] = useState({});
  const [other, setOther] = useState({});
  const values = row.questions.map((question, index) => {
    const chosen = question.options.filter((_, choice) => (selections[index] ?? []).includes(choice)).map(({ label }) => label);
    const input = custom[index]?.trim();
    if (other[index] || !question.options.length) {
      if (!input) return [];
      return question.multi ? [...chosen, input] : [input];
    }
    return chosen;
  });
  return <article className="thread-event thread-approval">
    <IconMessage size={19} />
    <div>
      <strong>{row.memberName ?? agentNames[row.agent]} · Needs your input</strong>
      {row.decision ? <p role="status">{row.decision}</p> : <form className="deck-question" onSubmit={(event) => {
        event.preventDefault();
        if (values.every((value) => value.length)) void answer(row, values);
      }}>
        {row.questions.map((question, index) => <fieldset key={question.id} disabled={busy}>
          <legend>{question.text}</legend>
          {question.options.map((option, choice) => <label key={choice}>
            <input name={row.id + "-" + index} type={question.multi ? "checkbox" : "radio"}
              checked={Boolean(selections[index]?.includes(choice)) && (question.multi || !other[index])}
              onChange={(event) => {
                const checked = event.target.checked;
                setSelections((prev) => ({ ...prev, [index]: question.multi
                  ? checked ? [...(prev[index] ?? []), choice] : (prev[index] ?? []).filter((entry) => entry !== choice)
                  : [choice] }));
                if (!question.multi) setOther((prev) => ({ ...prev, [index]: false }));
              }} />
            <span>{option.label}{option.description && <small>{option.description}</small>}</span>
          </label>)}
          {question.free && question.options.length > 0 && <label>
            <input name={row.id + "-" + index} type={question.multi ? "checkbox" : "radio"} checked={Boolean(other[index])}
              onChange={(event) => { const checked = event.target.checked; setOther((prev) => ({ ...prev, [index]: checked })); }} />
            <span>Write an answer</span>
          </label>}
          {question.free && (other[index] || !question.options.length) && <input
            aria-label={"Answer: " + question.text} type={question.secret ? "password" : "text"} maxLength={3000} autoComplete="off"
            value={custom[index] ?? ""} onChange={(event) => {
              const value = event.target.value;
              setCustom((prev) => ({ ...prev, [index]: value }));
            }} />}
        </fieldset>)}
        <div className="thread-actions">
          <button className="button small" type="button" disabled={busy} onClick={() => answer(row, null)}>Skip questions</button>
          <button className="button primary small" disabled={busy || values.some((value) => !value.length)}>Send answers</button>
        </div>
      </form>}
    </div>
  </article>;
}

export function ImageChips({ images, preview, remove, busy }) {
  if (!images?.length) return null;
  return <div className="thread-image-chips" aria-label="Attachments">
    {images.map((image) => <span key={image.id} className="thread-image-chip">
      <button type="button" className="thread-text-button" disabled={busy} title={image.name}
        aria-label={"Preview " + image.name} onClick={() => preview(image)}>
        {image.kind === "text" ? <IconFileText size={15} /> : <IconPhoto size={15} />}<span>{image.name}</span></button>
      {remove && <button type="button" className="icon-button" disabled={busy} aria-label={"Remove " + image.name}
        onClick={() => remove(image.id)}><IconX size={14} /></button>}
    </span>)}
  </div>;
}

function FeedRow({ row, run, busy, decide, answer, preview, summaryAction, profile, followup, chat = false }) {
  const replyRef = useRef(null);
  if (row.kind === "team-result") return <TeamRunResult run={row.run} work={chat ? undefined : row.work} summaryAction={summaryAction} chat={chat} followup={followup} />;
  if (row.kind === "prompt") return <div className="thread-prompt"><div className="thread-prompt-body">
    <p data-chat-quote="You">{row.text}</p><ImageChips images={row.images} preview={preview} busy={busy} />
  </div></div>;
  if (row.kind === "question") return <QuestionCard row={row} busy={busy} answer={answer} />;
  if (row.kind === "approval") {
    return <article className="thread-event thread-approval">
      <IconShieldCheck size={19} />
      <div><strong>{row.memberName ?? agentNames[row.agent]} · {row.title}</strong>{row.note && <p className="setting-detail">{row.note}</p>}<pre>{row.text}</pre>
        {row.decision ? <span>{row.decision}</span> : <div className="thread-actions">
          <button className="button small" disabled={busy} onClick={() => decide(row, false)}>Decline</button>
          <button className="button primary small" disabled={busy} onClick={() => decide(row, true)}>Approve once</button>
        </div>}
      </div>
    </article>;
  }
  const agent = row.memberName ?? agentNames[row.agent] ?? "AI Deck";
  if (row.kind === "system" || row.kind === "steered") {
    return <article className={`thread-notice ${row.limit ? "thread-limit" : ""}`}>
      <IconArrowRight size={16} /><div><strong>{row.kind === "steered" ? "You → " + agent : agent}</strong><p>{row.text}</p>
        <ImageChips images={row.images} preview={preview} busy={busy} /></div>
    </article>;
  }
  const plan = row.planDecision;
  const unverifiedBase = plan && autoTeamPlanNeedsBaseCheck(run);
  const reply = row.kind === "message" && <>
    {unverifiedBase && <p className="setting-detail">Verify the checkout before applying this plan.</p>}
    <ChatMarkdown className="thread-message" replyRef={replyRef} quote={agent} text={row.text} />
    {!unverifiedBase && plan?.assignments && <AutoTeamAssignments assignments={plan.assignments} />}
  </>;
  const badge = row.discussionConclusion ? "Team conclusion" : row.planDecision !== undefined ? "Team decision" : null;
  if (chat && row.kind === "message") return <article className="thread-chat-reply" aria-label={agent}>
    <div className="thread-chat-author">
      <AgentMark provider={row.provider ?? row.agent} />
      <strong>{agent}</strong>{row.to && <span> → {agentNames[row.to]}</span>}
      {badge && <span className="source-pill">{badge}</span>}
      <RunReceipt run={run} agent={row.agent} profile={profile} reply={row.text} replyRef={replyRef} followup={followup} />
    </div>
    {reply}
  </article>;
  return <article className={`thread-event ${row.provider ?? row.agent}`}>
    <span className="thread-avatar" aria-hidden="true"><AgentMark provider={row.provider ?? row.agent} /></span>
    <div><div className="thread-byline"><strong>{agent}</strong>{row.to && <span className="setting-detail thread-discussion-peer"> → {agentNames[row.to]}</span>}
      {badge && <span className="source-pill">{badge}</span>}
      {row.kind === "message" && <RunReceipt run={run} agent={row.agent} profile={profile} reply={row.text} replyRef={replyRef} followup={followup} />}</div>
      {row.kind === "work-activity"
        ? <OnDemandDetails className="thread-work-activity" summary={<>{row.steps.length} {row.steps.length === 1 ? "work step" : "work steps"}
            {" · "}{commandSummary(row.steps.at(-1).command ?? row.steps.at(-1).text)}</>}>
            <WorkSteps steps={row.steps} />
          </OnDemandDetails>
        : row.kind === "activity"
        ? <OnDemandDetails summary={<><IconTerminal2 size={14} />{row.text.split("\n")[0].slice(0, 150)}</>}><pre>{row.text}</pre></OnDemandDetails>
        : row.kind === "message" ? reply
        : <p className="thread-message">{row.text}</p>}
    </div>
  </article>;
}

const dateOnly = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const elapsed = (start, end) => Math.max(0, Math.floor((end - start) / 1000));

export function WorkTime({ startedAt, finishedAt, working }) {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!working || !Number.isFinite(start)) return;
    const tick = () => setSeconds(elapsed(start, Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [start, working]);
  const duration = working ? seconds : elapsed(start, finish);
  if (!Number.isFinite(start) || !Number.isFinite(duration)) return working ? "Working" : "Work activity";
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor(duration / 60) % 60;
  const label = [hours && hours + "h", minutes && minutes + "m", duration % 60 + "s"].filter(Boolean).join(" ");
  return (working ? "Working for " : "Worked for ") + label;
}

export function ChatTimestamp({ at, previousAt }) {
  const date = new Date(at);
  if (!at || !Number.isFinite(date.getTime())) return null;
  const previous = new Date(previousAt);
  if (date.toDateString() === previous.toDateString() && date - previous < 30 * 60 * 1000) return null;
  const day = date.toDateString() === new Date().toDateString() ? "Today" : dateOnly.format(date);
  return <time className="thread-chat-time" dateTime={date.toISOString()}>{day} · {timeOnly.format(date)}</time>;
}

function ChatTurn({ turn, previousAt, active, rowProps, teamPreview }) {
  const { run, prompt, work, rows } = turn;
  const startedAt = run?.startedAt ?? prompt?.startedAt;
  const handoffs = active && run?.collaboration?.handoffs;
  const expandable = work.length > 0 || handoffs?.length > 0;
  const showWork = active || Boolean(run?.finishedAt) || expandable;
  const timer = <WorkTime startedAt={startedAt} finishedAt={run?.finishedAt} working={active} />;
  return <div className="thread-chat-turn" data-run-id={turn.id} tabIndex={-1}>
    {prompt && <>
      <ChatTimestamp at={startedAt} previousAt={previousAt} />
      <FeedRow row={prompt} {...rowProps} chat />
    </>}
    {showWork && <div className="thread-chat-work" data-working={active || undefined}>
      {expandable ? <OnDemandDetails summary={<>
        {timer}<IconChevronRight size={15} aria-hidden="true" />
        {work.length > 0 && <span className="thread-work-count">{work.length} {work.length === 1 ? "step" : "steps"}</span>}
      </>}>
        {work.length > 0 && <WorkSteps steps={work} agentLabel={(step) => step.memberName ?? agentNames[step.agent]} />}
        {handoffs?.length > 0 && <TeamHandoffs handoffs={handoffs} />}
      </OnDemandDetails> : <div className="thread-chat-work-label">{timer}</div>}
    </div>}
    {rows.map((row) => teamPreview && row.kind === "message" ? null : <FeedRow key={row.id} row={row} run={run} {...rowProps} chat
      profile={row.profile ?? runModelProfile(run?.agents[row.agent])} />)}
    {teamPreview && <TeamAnswerPreview preview={teamPreview} />}
  </div>;
}

function Feed({ rows, runs, runById, activeRunId, name, busy, decide, answer, preview, empty, summaryAction, followup, teamPreview, notifiedTurn }) {
  const element = useRef(null);
  const follow = useRef(true);
  const scrollPosition = useRef(0);
  const scrollFrame = useRef(null);
  const [atEnd, setAtEnd] = useState(true);
  const [currentTurn, setCurrentTurn] = useState(null);
  const grouped = useMemo(() => runs ? conversationTurns(rows, runs) : groupWorkActivity(rows), [rows, runs]);
  const rowProps = { busy, decide, answer, preview, summaryAction, followup };
  function scrollToEnd() {
    const feed = element.current;
    if (!feed) return;
    feed.scrollTop = feed.scrollHeight;
    scrollPosition.current = feed.scrollTop;
  }
  function followOnFrame() {
    if (!follow.current || scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      if (follow.current && element.current) scrollToEnd();
    });
  }
  function jump() {
    follow.current = true;
    setAtEnd(true);
    setCurrentTurn(null);
    scrollToEnd();
  }
  function jumpToTurn(id, focus = true) {
    const turn = element.current?.querySelector(`[data-run-id="${CSS.escape(id)}"]`);
    if (!turn) return;
    follow.current = false;
    setCurrentTurn(id);
    if (focus) turn.focus({ preventScroll: true });
    turn.scrollIntoView({ block: "start" });
  }
  useLayoutEffect(() => {
    followOnFrame();
  }, [rows, teamPreview]);
  useLayoutEffect(() => {
    if (!notifiedTurn) return;
    const turn = element.current?.querySelector(`[data-run-id="${CSS.escape(notifiedTurn.runId)}"]`);
    if (!turn) return;
    const latest = turn === element.current.lastElementChild;
    follow.current = latest;
    turn.focus({ preventScroll: true });
    turn.scrollIntoView({ block: "end" });
    setAtEnd(latest);
  }, [notifiedTurn]);
  useEffect(() => {
    const observer = new ResizeObserver(followOnFrame);
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    };
  }, []);
  return (
    <section className={"thread-feed-wrap" + (runs && grouped.length > 1 ? " has-chat-rail" : "")} aria-label={name}>
      {runs && <ChatTurnRail turns={grouped} current={currentTurn ?? grouped.at(-1)?.id} jump={jumpToTurn} />}
      <div className={runs ? "thread-feed thread-chat-feed" : "thread-feed"} role="log" aria-label={name} ref={element} onScroll={(event) => {
        const feed = event.currentTarget;
        const { scrollHeight, clientHeight, scrollTop } = feed;
        const nearEnd = scrollHeight - clientHeight - scrollTop < 36;
        if (!nearEnd && scrollTop === scrollPosition.current) return;
        scrollPosition.current = scrollTop;
        follow.current = nearEnd;
        setAtEnd(follow.current);
        if (runs && nearEnd) setCurrentTurn(null);
        else if (runs) {
          const top = feed.getBoundingClientRect().top + 48;
          let current;
          for (const turn of feed.children) {
            if (current && turn.getBoundingClientRect().top > top) break;
            current = turn.dataset.runId;
          }
          setCurrentTurn(current);
        }
      }}>
        {grouped.length ? grouped.map((item, index) => runs
          ? <ChatTurn key={item.id} turn={item} active={item.id === activeRunId}
            previousAt={grouped[index - 1]?.run?.startedAt} rowProps={rowProps}
            teamPreview={teamPreview?.runId === item.id ? teamPreview : undefined} />
          : <FeedRow key={item.id} row={item} {...rowProps}
            run={runById?.get(item.id.split(":", 1)[0])}
            profile={item.profile ?? runModelProfile(runById?.get(item.id.split(":", 1)[0])?.agents[item.agent])} />)
          : <p className="thread-empty">{empty}</p>}
      </div>
      {!atEnd && <button className="button small thread-jump" onClick={jump}>Jump to latest</button>}
    </section>
  );
}

export function Activity({ split, taskId, rows, runs, activeRunId, busy, decide, answer, preview, result, summaryAction, followup, teamPreview, notifiedTurn }) {
  const [selectedLane, setSelectedLane] = useState("codex");
  const runById = useMemo(() => split && new Map(runs.map((run) => [run.id, run])), [split, runs]);
  const laneRows = useMemo(() => split && Object.fromEntries(Object.keys(agentNames).map((agent) => [agent,
    rows.filter((row) => row.agent === agent || row.kind === "prompt" && row.agents.includes(agent))])), [split, rows]);
  if (split) return <div className="thread-split" key={taskId}>
    <div className="thread-split-switch" role="group" aria-label="Agent activity">
      {Object.entries(agentNames).map(([agent, name]) => <button className="button small" key={agent} type="button"
        aria-pressed={selectedLane === agent} onClick={() => setSelectedLane(agent)}><Brand agent={agent} size={15} />{name}</button>)}
    </div>
    {Object.entries(agentNames).map(([agent, name]) => (
      <section className={`thread-split-lane ${agent}`} aria-label={name} data-selected={selectedLane === agent} key={agent}>
        <h2>{name}</h2>
        <Feed name={name + " activity"} rows={laneRows[agent]} runById={runById} busy={busy} decide={decide} answer={answer} preview={preview} followup={followup} empty="No activity yet." />
      </section>
    ))}
    {(teamPreview || result) && <div className="thread-split-answer">{teamPreview ? <TeamAnswerPreview preview={teamPreview} />
      : <TeamRunResult run={result} summaryAction={summaryAction} followup={followup} />}</div>}
  </div>;
  return <Feed key={taskId} name="Team timeline" rows={rows} runs={runs} activeRunId={activeRunId} busy={busy} decide={decide}
    answer={answer} preview={preview} summaryAction={summaryAction} followup={followup} teamPreview={teamPreview} notifiedTurn={notifiedTurn} empty="Send a task to start the team conversation." />;
}

export function Queue({ items, working, activeMode, steerAgents, sessionTeamSteer, busy, steer, remove, next, lowMemory, preview }) {
  if (!items.length) return null;
  return <section className="thread-queue" aria-label="Queued messages">
    <div className="thread-queue-heading"><strong>{working ? "Queued messages" : "Queue paused"}</strong>
      {!working && <button className="button small" disabled={busy || items[0].steering} onClick={next}>Run next</button>}
    </div>
    {items.map((item) => (
      <div className="thread-queue-row" key={item.id}>
        <div>{item.prompt && <p>{item.prompt}</p>}{item.steering && <small>Steer acknowledgement uncertain · review before resending</small>}
          <ImageChips images={item.images} preview={preview} busy={busy} />
          {item.askAgent ? <small>Ask {agentNames[item.askAgent]}</small> :
            <AssignmentEvidence mode={item.mode} teamwork={item.teamworkSnapshot ?? item.teamwork} label="Queued roles" lowMemory={lowMemory} />}</div>
        <div className="thread-actions">
          {sessionTeamSteer && steerableDraft(item, sessionTeamMode) &&
            <button type="button" className="button small" disabled={busy} title={"Steer " + sessionTeamSteer.name}
              onClick={() => steer(item.id, sessionTeamSteer.agent, sessionTeamSteer)}>Steer</button>}
          {steerableDraft(item, activeMode) && steerAgents.map((agent) =>
            <button key={agent} type="button" className="button small" disabled={busy} onClick={() => steer(item.id, agent)}>
              {agent === "codex" ? "Steer Codex" : "Send to Claude"}
            </button>)}
          <button className="icon-button" aria-label="Remove queued message" disabled={busy} onClick={() => remove(item.id)}><IconX size={16} /></button>
        </div>
      </div>
    ))}
  </section>;
}
