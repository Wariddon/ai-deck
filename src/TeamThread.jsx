import { useEffect, useRef, useState } from "react";
import {
  IconArrowRight, IconChevronRight, IconFolder, IconGitBranch, IconMessage, IconPhoto, IconPlus,
  IconShieldCheck, IconTerminal2, IconX,
} from "@tabler/icons-react";
import { routeMode } from "../desktop/usage-routing.mjs";
import { agentRole } from "../desktop/collaboration.mjs";

export const agentNames = { codex: "Codex", claude: "Claude Code" };
export const modeNames = {
  team: "Team · Parallel", "claude-team": "Team · Claude leads", "build-review": "Codex builds → Claude reviews", "claude-build-review": "Claude builds → Codex reviews",
  "claude-plan-codex": "Claude plans → Codex implements", "codex-plan-claude": "Codex plans → Claude implements",
  "parallel-write": "Team · Separate edits", "claude-parallel-write": "Separate edits · Claude leads", codex: "Codex", "codex-review": "Codex · Review", "codex-plan": "Codex · Plan", claude: "Claude · Review", "claude-plan": "Claude · Plan", "claude-write": "Claude · Edit",
};
export function modeLabel(mode, lowMemory) {
  if (lowMemory && mode === "team") return "Team · One at a time";
  if (lowMemory && mode === "claude-team") return "Team · Claude first";
  if (lowMemory && mode === "claude-parallel-write") return "Separate edits · Claude first";
  return modeNames[mode];
}
const roleTitle = { plan: "Plan", review: "Review", write: "Implement" };

export function AssignmentEvidence({ mode, teamwork, label = "Role assignment", lowMemory, open = false }) {
  const agents = routeMode(mode, {}).requested;
  if (!agents.length) return null;
  return <details className="deck-assignment-evidence" open={open || undefined}>
    <summary>{label} · {modeLabel(mode, lowMemory)}</summary>
    <div className="deck-assignment-content">
      {agents.map((agent) => <div key={agent}>
        <strong>{agentNames[agent]} · {roleTitle[agentRole(mode, agent)]}</strong>
        <p>{teamwork?.[agent] || "Uses the task prompt."}</p>
      </div>)}
      {teamwork?.brief && <p><strong>Shared brief</strong> {teamwork.brief}</p>}
      {teamwork?.outcome && <p><strong>Done when / handoff</strong> {teamwork.outcome}</p>}
    </div>
  </details>;
}

export const projectName = (repo) => repo.split(/[\\/]/u).at(-1);

export function Sidebar({ repositories, workspace, busy, openRepo, openTask, newTask }) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase();
  const matches = (task, repo) => !term || `${task.title} ${projectName(repo)}`.toLocaleLowerCase().includes(term);
  const recent = repositories.flatMap((project) => project.tasks.filter((task) => matches(task, project.repo)).map((task) => ({ ...task, repo: project.repo })))
    .sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? "")).slice(0, term ? 30 : 8);
  return (
    <aside className="thread-sidebar" id="deck-project-sidebar" aria-label="Projects and recent tasks">
      <button className="button thread-new" onClick={workspace ? newTask : openRepo} disabled={busy}><IconPlus size={17} />New task</button>
      {repositories.length > 0 && <input type="search" className="thread-search" aria-label="Search tasks" placeholder="Find tasks…" value={query} onChange={(event) => setQuery(event.target.value)} />}
      <div className="thread-side-heading"><span>Projects</span><button className="icon-button" aria-label="Open repository" title="Open repository" disabled={busy} onClick={openRepo}><IconFolder size={17} /></button></div>
      {!repositories.length && <p className="thread-side-empty">Open a Git repo to start.</p>}
      {repositories.map((project) => {
        const current = workspace?.repo === project.repo;
        return (
          <div className="thread-project" key={project.repo}>
            <button className="thread-side-row" type="button" title={project.repo} disabled={busy || current} onClick={() => openTask(project.repo, project.currentTask)}>
              <IconFolder size={16} /><span>{projectName(project.repo)}</span><IconChevronRight size={12} />
            </button>
            {current && project.tasks.filter((task) => matches(task, project.repo)).map((task) => (
              <button key={task.id} className="thread-side-row thread-task-row" type="button" disabled={busy} aria-current={workspace.taskId === task.id ? "page" : undefined}
                title={task.title} onClick={() => openTask(project.repo, task.id)}>
                <IconMessage size={14} /><span>{task.title}</span>{task.queued > 0 && <small>{task.queued}</small>}
              </button>
            ))}
          </div>
        );
      })}
      {recent.length > 0 && <div className="thread-recents">
        <div className="thread-side-heading">Recent</div>
        {recent.map((task) => <button className="thread-side-row" key={task.id} type="button" disabled={busy} title={task.title} onClick={() => openTask(task.repo, task.id)}>
          <IconMessage size={14} /><span>{task.title}</span>
        </button>)}
      </div>}
      {term && !recent.length && <p className="thread-side-empty">No matching tasks.</p>}
      {workspace?.base && <div className="thread-side-branch"><IconGitBranch size={15} /><code>{workspace.base.slice(0, 8)}</code></div>}
    </aside>
  );
}

function QuestionCard({ row, busy, answer }) {
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
      <strong>{agentNames[row.agent]} · Needs your input</strong>
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
  return <div className="thread-image-chips" aria-label="Attached images">
    {images.map((image) => <span key={image.id} className="thread-image-chip">
      <button type="button" className="thread-text-button" disabled={busy} title={image.name}
        aria-label={"Preview " + image.name} onClick={() => preview(image)}><IconPhoto size={15} /><span>{image.name}</span></button>
      {remove && <button type="button" className="icon-button" disabled={busy} aria-label={"Remove " + image.name}
        onClick={() => remove(image.id)}><IconX size={14} /></button>}
    </span>)}
  </div>;
}

function FeedRow({ row, busy, decide, answer, preview }) {
  if (row.kind === "prompt") return <div className="thread-prompt"><div className="thread-prompt-body">
    <p>{row.text}</p><ImageChips images={row.images} preview={preview} busy={busy} />
  </div></div>;
  if (row.kind === "question") return <QuestionCard row={row} busy={busy} answer={answer} />;
  if (row.kind === "approval") {
    return <article className="thread-event thread-approval">
      <IconShieldCheck size={19} />
      <div><strong>{agentNames[row.agent]} · {row.title}</strong>{row.note && <p className="setting-detail">{row.note}</p>}<pre>{row.text}</pre>
        {row.decision ? <span>{row.decision}</span> : <div className="thread-actions">
          <button className="button small" disabled={busy} onClick={() => decide(row, false)}>Decline</button>
          <button className="button primary small" disabled={busy} onClick={() => decide(row, true)}>Approve once</button>
        </div>}
      </div>
    </article>;
  }
  const agent = agentNames[row.agent] ?? "AI Deck";
  if (row.kind === "system" || row.kind === "steered") {
    return <article className={`thread-notice ${row.limit ? "thread-limit" : ""}`}>
      <IconArrowRight size={16} /><div><strong>{row.kind === "steered" ? "You → " + agent : agent}</strong><p>{row.text}</p>
        <ImageChips images={row.images} preview={preview} busy={busy} /></div>
    </article>;
  }
  return <article className={`thread-event ${row.agent}`}>
    <span className="thread-avatar" aria-hidden="true">{row.agent === "codex" ? "C" : "A"}</span>
    <div><div className="thread-byline"><strong>{agent}</strong></div>
      {row.kind === "activity"
        ? <details><summary><IconTerminal2 size={14} />{row.text.split("\n")[0].slice(0, 150)}</summary><pre>{row.text}</pre></details>
        : <p className="thread-message">{row.text}</p>}
    </div>
  </article>;
}

function Feed({ rows, name, busy, decide, answer, preview, empty }) {
  const element = useRef(null);
  const follow = useRef(true);
  const [atEnd, setAtEnd] = useState(true);
  function jump() {
    follow.current = true;
    setAtEnd(true);
    if (element.current) element.current.scrollTop = element.current.scrollHeight;
  }
  useEffect(() => {
    if (follow.current && element.current) element.current.scrollTop = element.current.scrollHeight;
  }, [rows]);
  return (
    <section className="thread-feed-wrap" aria-label={name}>
      <div className="thread-feed" role="log" aria-label={name} ref={element} onScroll={(event) => {
        const { scrollHeight, clientHeight, scrollTop } = event.currentTarget;
        follow.current = scrollHeight - clientHeight - scrollTop < 36;
        setAtEnd(follow.current);
      }}>
        {rows.length ? rows.map((row) => <FeedRow key={row.id} row={row} busy={busy} decide={decide} answer={answer} preview={preview} />) : <p className="thread-empty">{empty}</p>}
      </div>
      {!atEnd && <button className="button small thread-jump" onClick={jump}>Jump to latest</button>}
    </section>
  );
}

export function Activity({ split, taskId, rows, busy, decide, answer, preview }) {
  if (split) return <div className="thread-split" key={taskId}>
    {Object.entries(agentNames).map(([agent, name]) => (
      <section className={`thread-split-lane ${agent}`} key={agent}>
        <h2>{name}</h2>
        <Feed name={name + " activity"} rows={rows.filter((row) => row.agent === agent || row.kind === "prompt" && row.agents.includes(agent))} busy={busy} decide={decide} answer={answer} preview={preview} empty="No activity yet." />
      </section>
    ))}
  </div>;
  return <Feed key={taskId} name="Team timeline" rows={rows} busy={busy} decide={decide} answer={answer} preview={preview} empty="Send a task to start the team conversation." />;
}

export function Queue({ items, working, activeMode, canSteer, canFollowClaude, busy, steer, remove, next, lowMemory, preview }) {
  if (!items.length) return null;
  return <section className="thread-queue" aria-label="Queued messages">
    <div className="thread-queue-heading"><strong>{working ? "Queued messages" : "Queue paused"}</strong>
      {!working && <button className="button small" disabled={busy || items[0].steering} onClick={next}>Run next</button>}
    </div>
    {items.map((item) => (
      <div className="thread-queue-row" key={item.id}>
        <div>{item.prompt && <p>{item.prompt}</p>}{item.steering && <small>Steer acknowledgement uncertain · review before resending</small>}
          <ImageChips images={item.images} preview={preview} busy={busy} />
          <AssignmentEvidence mode={item.mode} teamwork={item.teamworkSnapshot ?? item.teamwork} label="Queued roles" lowMemory={lowMemory} /></div>
        <div className="thread-actions">
          {!item.steering && !item.assignmentOnce && item.teamwork === undefined && !item.skillIds?.length && item.reviewFiles === undefined && !item.reviewOf && !item.reviewTarget && !item.reviewSince && item.mode === activeMode && routeMode(item.mode, {}).requested.length === 1 && routeMode(item.mode, {}).requested.map((agent) => {
            if (agent === "codex" && canSteer) return <button key={agent} className="button small" disabled={busy} onClick={() => steer(item.id, agent)}>Steer Codex</button>;
            if (agent === "claude" && canFollowClaude) return <button key={agent} className="button small" disabled={busy} onClick={() => steer(item.id, agent)}>Send to Claude</button>;
            return null;
          })}
          <button className="icon-button" aria-label="Remove queued message" disabled={busy} onClick={() => remove(item.id)}><IconX size={16} /></button>
        </div>
      </div>
    ))}
  </section>;
}
