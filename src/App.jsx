import { useEffect, useRef, useState } from "react";
import {
  IconArrowRight, IconBrandOpenai, IconChartBar, IconCheck, IconFileCode, IconFolder, IconGitBranch,
  IconHistory, IconMessage, IconPlus, IconPuzzle, IconSettings, IconStack2, IconTerminal2, IconX,
} from "@tabler/icons-react";
import claudeLogo from "simple-icons/icons/claude.svg?url";
import { advanceTurn, emptyWorkspace, fileContent, files, makeTurn, memory, prompts, summarizeUsage } from "./sandbox.js";
const catalog = [
  { id: "git-inspector", name: "Git Inspector", description: "Share a read-only patch summary with the team." },
  { id: "test-runner", name: "Test Runner", description: "Show a shared report from a simulated test run." },
  { id: "repo-notes", name: "Repo Notes", description: "Show a shared workspace notes source." },
];
const scopes = { both: "Both agents", codex: "Codex only", claude: "Claude only" };
const defaultConfig = {
  sources: ["codex", "claude"],
  skill: true,
  instructions: "Preserve existing retry guards and include regression coverage.",
  askBeforeEdits: true,
  manualHandoff: false,
  plugins: [],
};
const providerNames = { codex: "Codex", claude: "Claude" };
const tokenFormat = new Intl.NumberFormat("en-US");

function readConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem("ai-deck-demo-v1"));
    return { ...defaultConfig, ...saved };
  } catch {
    return defaultConfig;
  }
}

function ProviderIcon({ agent, size = 38 }) {
  if (agent === "codex") return <IconBrandOpenai size={size} stroke={1.6} aria-hidden="true" />;
  return <span className="provider-icon" style={{ width: size, height: size, maskImage: `url("${claudeLogo}")` }} aria-hidden="true" />;
}

function RailButton({ label, icon: Icon, onClick }) {
  return <button type="button" className="rail-button" title={label} aria-label={label} onClick={onClick}><Icon size={28} stroke={1.7} /></button>;
}

function Dialog({ title, close, children, wide = false }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog ref={dialog} className={wide ? "dialog dialog-wide" : "dialog"} aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="dialog-heading">
        <div><p className="eyebrow">AI Deck</p><h2 id="dialog-title">{title}</h2></div>
        <button className="icon-button" aria-label="Close dialog" onClick={close}><IconX size={20} /></button>
      </div>
      {children}
    </dialog>
  );
}

function ContextDialog({ config, setConfig, close }) {
  const toggleSource = (id) => setConfig((current) => ({
    ...current,
    sources: current.sources.includes(id)
      ? current.sources.filter((source) => source !== id)
      : [...current.sources, id],
  }));
  return (
    <Dialog title="Context & Skills" close={close}>
      <p className="dialog-intro">Select the saved knowledge and project skill that both agents will receive on the next run. This preview uses example sources.</p>
      <h3>Saved knowledge</h3>
      <div className="setting-list">
        {memory.map((entry) => (
          <label className="setting-row" key={entry.id}>
            <input type="checkbox" checked={config.sources.includes(entry.id)} onChange={() => toggleSource(entry.id)} />
            <span><strong>{entry.name}</strong><span className="setting-detail">{entry.note}</span></span>
            <span className={`source-pill ${entry.id}`}>{providerNames[entry.id]}</span>
          </label>
        ))}
      </div>
      <h3>Shared skill</h3>
      <label className="setting-row setting-list">
        <input type="checkbox" checked={config.skill} onChange={(event) => setConfig({ ...config, skill: event.target.checked })} />
        <span><strong>Regression review</strong><span className="setting-detail">Reproduce the issue, test simultaneous requests, and report the evidence.</span></span>
        <span className="source-pill">Both agents</span>
      </label>
      <div className="dialog-actions"><button className="button primary" onClick={close}>Done</button></div>
    </Dialog>
  );
}

function SettingsDialog({ config, setConfig, close, openPlugins }) {
  return (
    <Dialog title="Team settings" close={close}>
      <p className="dialog-intro">Settings apply to Codex and Claude together on the next run.</p>
      <label className="field">
        <strong>Shared instructions</strong>
        <textarea rows={3} maxLength={400} value={config.instructions} onChange={(event) => setConfig({ ...config, instructions: event.target.value })} />
      </label>
      <label className="setting-row setting-list">
        <input type="checkbox" checked={config.askBeforeEdits} onChange={(event) => setConfig({ ...config, askBeforeEdits: event.target.checked })} />
        <span><strong>Ask before editing</strong><span className="setting-detail">Review the proposed patch before it is applied to the sandbox files.</span></span>
      </label>
      <label className="setting-row setting-list">
        <input type="checkbox" checked={config.manualHandoff} onChange={(event) => setConfig({ ...config, manualHandoff: event.target.checked })} />
        <span><strong>Approve handoffs</strong><span className="setting-detail">Pause when Claude sends a finding to Codex so you can approve it.</span></span>
      </label>
      <div className="dialog-actions"><button className="button" onClick={openPlugins}>Manage plugins</button><button className="button primary" onClick={close}>Done</button></div>
    </Dialog>
  );
}

function PluginsDialog({ config, setConfig, close }) {
  const [name, setName] = useState("");
  const duplicate = config.plugins.some((plugin) => plugin.name.toLowerCase() === name.trim().toLowerCase());
  function add(plugin) {
    setConfig((current) => ({ ...current, plugins: [...current.plugins, { ...plugin, scope: "both", enabled: true }] }));
  }
  function update(id, change) {
    setConfig((current) => ({
      ...current,
      plugins: current.plugins.map((plugin) => plugin.id === id ? { ...plugin, ...change } : plugin),
    }));
  }
  function remove(id) {
    setConfig((current) => ({ ...current, plugins: current.plugins.filter((plugin) => plugin.id !== id) }));
  }
  return (
    <Dialog title="Plugins" close={close}>
      <p className="dialog-intro">Add a simulated connector to the workspace and choose which agents can use it. Changes apply to the next run.</p>
      <h3>Installed in this demo</h3>
      {config.plugins.length === 0 && <p className="empty">No plugins added yet.</p>}
      <div className="setting-list">
        {config.plugins.map((plugin) => (
          <div className="plugin-row" key={plugin.id}>
            <label className="plugin-enable">
              <input type="checkbox" checked={plugin.enabled} onChange={(event) => update(plugin.id, { enabled: event.target.checked })} />
              <strong>{plugin.name}</strong>
            </label>
            <select aria-label={`${plugin.name} scope`} value={plugin.scope} onChange={(event) => update(plugin.id, { scope: event.target.value })}>
              {Object.entries(scopes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button className="icon-button" title={`Remove ${plugin.name}`} aria-label={`Remove ${plugin.name}`} onClick={() => remove(plugin.id)}><IconX size={17} /></button>
          </div>
        ))}
      </div>
      <h3>Demo catalog</h3>
      <div className="setting-list">
        {catalog.map((plugin) => {
          const added = config.plugins.some((item) => item.name.toLowerCase() === plugin.name.toLowerCase());
          return (
            <div className="catalog-row" key={plugin.id}>
              <span><strong>{plugin.name}</strong><span className="setting-detail">{plugin.description}</span></span>
              <button className="button small" aria-label={`Add ${plugin.name}`} disabled={added} onClick={() => add(plugin)}>
                {added ? <IconCheck size={16} /> : <IconPlus size={16} />}{added ? "Added" : "Add"}
              </button>
            </div>
          );
        })}
      </div>
      <form className="custom-plugin" onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || duplicate) return;
        add({ id: crypto.randomUUID(), name: name.trim(), description: "Custom demo connector" });
        setName("");
      }}>
        <label className="field"><strong>Custom plugin</strong><input placeholder="Plugin name" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <button className="button" disabled={!name.trim() || duplicate}>Add custom</button>
      </form>
      {duplicate && <p className="empty">A plugin with that name is already added.</p>}
    </Dialog>
  );
}

function CheckRows({ results }) {
  if (!results) return <p className="setting-detail">Running sandbox checks…</p>;
  return (
    <ul className="check-results">
      {results.map((row) => (
        <li key={row.label} className={row.pass ? "pass" : "fail"}>
          <b>{row.pass ? "PASS" : "FAIL"}</b> {row.label}
          {!row.pass && <span>Expected {row.expected.toLocaleString()}, got {row.actual.toLocaleString()}</span>}
        </li>
      ))}
    </ul>
  );
}

function ActivityItem({ item, results, decision, stopped }) {
  if (item.kind === "tool") {
    return (
      <details className="tool-event">
        <summary><IconFileCode size={15} />{item.title}{decision && <span className="tool-decision">{decision === "skipped" ? "Skipped" : "Applied"}</span>}</summary>
        <pre>{item.detail}</pre>
      </details>
    );
  }
  if (item.kind === "check") {
    return <div className="tool-event check-event"><strong><IconTerminal2 size={15} />{item.detail}</strong>{stopped && !results ? <p className="setting-detail">Check stopped.</p> : <CheckRows results={results} />}</div>;
  }
  return (
    <div className={`activity-note ${item.kind === "handoff" ? "activity-handoff" : ""}`}>
      <strong>{item.title}</strong><p>{item.detail}</p>
    </div>
  );
}

function ReviewResult({ entry }) {
  const checks = Object.values(entry.checks).flat();
  const failed = checks.filter((row) => !row.pass).length;
  if (failed) return <p className="review-complete fail">{failed} {failed === 1 ? "check needs" : "checks need"} attention.</p>;
  return <p className="review-complete"><IconCheck size={15} />{checks.length ? "Reviewed the passing checks" : "Review complete"}</p>;
}

function AgentLane({ agent, turns, usage, openUsage }) {
  const turn = turns.at(-1);
  const isCodex = agent === "codex";
  const busy = turn?.status === "running";
  const awaiting = busy && turn.steps[turn.cursor].approval;
  const label = !turn ? "Ready" : awaiting ? "Awaiting approval" : busy ? "Working" : turn.status === "stopped" ? "Stopped" : "Turn complete";
  const plugins = turn?.config.plugins.filter((plugin) => plugin.enabled && (plugin.scope === "both" || plugin.scope === agent)) ?? [];
  const feed = useRef(null);
  useEffect(() => {
    const element = feed.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [turn?.id, turn?.cursor, turn?.status]);

  return (
    <section className={`agent-lane ${agent}`} aria-label={providerNames[agent]}>
      <header className="agent-header">
        <ProviderIcon agent={agent} />
        <h2>{providerNames[agent]}</h2><span className="role-pill">{isCodex ? "Implementer" : "Reviewer"}</span>
        <span className="agent-status">{busy && !awaiting && <span className="live-dot" />}{label}</span>
      </header>
      {turn ? (
        <>
          <div className="agent-context">
            <span>{turn.config.sources.length} memory sources</span>
            {turn.config.skill && <span>Regression review</span>}
            {plugins.map((plugin) => <span key={plugin.id}>{plugin.name}</span>)}
            <button className="usage-chip" onClick={openUsage} aria-label={`View ${providerNames[agent]} estimated usage`}>
              {tokenFormat.format(usage.input + usage.output)} est. tokens
            </button>
          </div>
          <div ref={feed} className="activity-feed" role="log" aria-label={providerNames[agent] + " activity"}>
            {turns.map((entry, index) => (
              <section className="activity-turn" key={entry.id}>
                <p className="turn-label">Turn {index + 1}</p>
                <p className="turn-prompt">{entry.prompt}</p>
                {entry.steps.slice(0, entry.cursor + 1).map((step, stepIndex) => step.events.filter((item) => item.agent === agent).map((item) => (
                  <ActivityItem key={stepIndex + item.title} item={item} results={entry.checks[stepIndex]} decision={entry.decisions[stepIndex]} stopped={entry.status === "stopped"} />
                )))}
                {entry.status === "stopped" && <p className="activity-note">Run stopped.</p>}
                {entry.status === "completed" && !isCodex && <ReviewResult entry={entry} />}
              </section>
            ))}
          </div>
        </>
      ) : (
        <div className="lane-empty">
          {isCodex ? "I’ll read the files, propose an edit, and run checks." : "I’ll inspect the same workspace in parallel and send findings to Codex."}
        </div>
      )}
    </section>
  );
}

function UsageDialog({ usage, close }) {
  const [scope, setScope] = useState("session");
  return (
    <Dialog title="Usage" close={close}>
      <p className="dialog-intro">Estimated tokens from the sandbox prompt, context, and visible activity. Figures are demo estimates.</p>
      <div className="workspace-tabs" aria-label="Usage period">
        <button className="button small" aria-pressed={scope === "latest"} onClick={() => setScope("latest")}>Latest turn</button>
        <button className="button small" aria-pressed={scope === "session"} onClick={() => setScope("session")}>Session total</button>
      </div>
      <div className="usage-grid" aria-live="polite">
        {Object.entries(providerNames).map(([agent, name]) => {
          const { input, output } = usage[scope][agent];
          return (
            <section className={`usage-card ${agent}`} key={agent} aria-label={name + " usage"}>
              <h3><ProviderIcon agent={agent} size={21} />{name}</h3>
              <dl>
                <div><dt>Input</dt><dd>{tokenFormat.format(input)}</dd></div>
                <div><dt>Output</dt><dd>{tokenFormat.format(output)}</dd></div>
                <div className="usage-total"><dt>Total tokens</dt><dd>{tokenFormat.format(input + output)}</dd></div>
              </dl>
            </section>
          );
        })}
      </div>
      <div className="dialog-actions"><button className="button primary" onClick={close}>Done</button></div>
    </Dialog>
  );
}

function Diff({ id, label }) {
  const file = files[id];
  const removed = file.before.filter((line) => !file.after.includes(line));
  const added = file.after.filter((line) => !file.before.includes(line));
  return (
    <section className="work-diff">
      <header><code>{file.path}</code><span className="source-pill">{label}</span></header>
      <pre>{removed.map((line) => <span key={line} className="removed">{`− ${line}\n`}</span>)}{added.map((line) => <span key={line} className="added">{`+ ${line}\n`}</span>)}</pre>
    </section>
  );
}

function WorkspacePanel({ mode, session, proposal, close, selectMode }) {
  const [file, setFile] = useState("retry");
  const changed = Object.keys(files).filter((id) => session.workspace[id]);
  const checks = session.turns.flatMap((turn, turnIndex) => turn.steps.slice(0, turn.cursor + 1)
    .flatMap((step, index) => step.check ? [{ turn, step, index, turnNumber: turnIndex + 1 }] : []));
  return (
    <Dialog title="Sandbox workspace" close={close} wide>
      <div className="workspace-tabs" aria-label="Workspace views">
        {["Files", "Changes", "Terminal"].map((label) => <button key={label} className="button small" aria-pressed={mode === label} onClick={() => selectMode(label)}>{label}</button>)}
      </div>
      {mode === "Files" && (
        <>
          <label className="field"><strong>Workspace file</strong><select value={file} onChange={(event) => setFile(event.target.value)}>
            {Object.entries(files).map(([id, entry]) => <option key={id} value={id}>{entry.path}</option>)}
          </select></label>
          <pre className="file-preview">{fileContent(file, session.workspace)}</pre>
        </>
      )}
      {mode === "Changes" && (
        <>
          {proposal && <Diff id={proposal} label="Proposed · awaiting approval" />}
          {changed.map((id) => <Diff key={id} id={id} label="Applied to sandbox" />)}
          {!proposal && !changed.length && <p className="empty">No workspace changes yet.</p>}
        </>
      )}
      {mode === "Terminal" && (
        <>
          <p className="dialog-intro">Each check ran in the browser against the sandbox revision for that turn.</p>
          {!checks.length && <p className="empty">No commands yet. Try Run tests or approve a patch.</p>}
          <div className="terminal-log">
            {checks.map(({ turn, step, index, turnNumber }) => (
              <div key={turn.id + "-" + index}>
                <p className="turn-label">Turn {turnNumber}</p>
                <code>$ deck check {step.check}</code>
                {turn.status === "stopped" && !turn.checks[index] ? <p>Check stopped.</p> : <CheckRows results={turn.checks[index]} />}
              </div>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}

export function App() {
  const [config, setConfig] = useState(readConfig);
  const [message, setMessage] = useState("");
  const [queued, setQueued] = useState(null);
  const [session, setSession] = useState({ workspace: emptyWorkspace, turns: [] });
  const [modal, setModal] = useState(null);
  const [panel, setPanel] = useState("Files");
  const composer = useRef(null);
  const turn = session.turns.at(-1);
  const running = turn?.status === "running";
  const currentStep = turn?.steps[turn.cursor];
  const approval = running ? currentStep.approval : null;
  const visibleConfig = running ? turn.config : config;
  const pluginCount = visibleConfig.plugins.filter((plugin) => plugin.enabled).length;
  const changes = Object.values(session.workspace).filter(Boolean).length;
  const usage = summarizeUsage(session.turns);
  const handoff = turn?.steps.slice(0, turn.cursor + 1).find((step) => step.handoff)?.handoff;

  useEffect(() => {
    try { localStorage.setItem("ai-deck-demo-v1", JSON.stringify(config)); } catch { /* Browser storage may be disabled. */ }
  }, [config]);

  useEffect(() => {
    if (!running || approval) return;
    const { id, cursor } = turn;
    const timer = window.setTimeout(() => {
      setSession((current) => advanceTurn(current, id, cursor));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [running, approval, turn?.id, turn?.cursor]);

  useEffect(() => {
    if (turn?.status !== "completed" || !queued) return;
    setSession((current) => {
      if (current.turns.at(-1)?.id !== turn.id) return current;
      return { ...current, turns: [...current.turns, makeTurn(queued.id, queued.prompt, current.workspace, queued.config)] };
    });
    setQueued(null);
  }, [turn?.status, turn?.id, queued]);

  function startTurn(prompt, settings = config, id = crypto.randomUUID()) {
    setSession((current) => ({ ...current, turns: [...current.turns, makeTurn(id, prompt, current.workspace, settings)] }));
  }
  function submit(event) {
    event.preventDefault();
    const text = message.trim();
    if (!text || queued) return;
    if (running) setQueued({ id: crypto.randomUUID(), prompt: text, config });
    else startTurn(text);
    setMessage("");
  }
  function stopTurn() {
    setSession((current) => {
      const latest = current.turns.at(-1);
      if (latest?.status !== "running") return current;
      return { ...current, turns: [...current.turns.slice(0, -1), { ...latest, status: "stopped" }] };
    });
  }
  function choosePrompt(prompt) {
    setMessage(prompt);
    composer.current.focus();
  }
  function showWorkspace(mode) {
    setPanel(mode);
    setModal("workspace");
  }
  function runFromToolbar() {
    if (queued) {
      startTurn(queued.prompt, queued.config, queued.id);
      setQueued(null);
    } else {
      startTurn(message.trim() || prompts.retry);
      setMessage("");
    }
  }
  const close = () => setModal(null);
  const openUsage = () => setModal("usage");
  const resolveApproval = (decision) => setSession((current) => advanceTurn(current, turn.id, turn.cursor, decision));

  return (
    <main className="deck studio">
      <header className="titlebar">
        <div className="wordmark"><IconStack2 size={34} stroke={2.7} /><span>AI Deck</span></div>
        <div className="breadcrumb">queue-service / Workspace</div>
        <span className="demo-label">Interactive sandbox</span>
      </header>
      <div className="deck-layout">
        <nav className="rail" aria-label="Workspace">
          <RailButton label="Workspace files" icon={IconFolder} onClick={() => showWorkspace("Files")} />
          <RailButton label="Run history" icon={IconHistory} onClick={() => setModal("history")} />
          <RailButton label="Team settings" icon={IconSettings} onClick={() => setModal("settings")} />
          <RailButton label="Plugins" icon={IconPuzzle} onClick={() => setModal("plugins")} />
        </nav>
        <section className="workspace" aria-label="Team task">
          <header className="task-heading">
            <div className="task-brief"><h1>Team workspace</h1><p><IconGitBranch size={17} /> sandbox / queue-service</p></div>
            <div className="task-actions">
              <button className="team-button" onClick={() => setModal("settings")}>Team Mode</button>
              {running ? (
                <button className="button primary run-button" onClick={stopTurn}><span className="stop-icon" aria-hidden="true" />Stop run</button>
              ) : (
                <button className="button primary run-button" onClick={runFromToolbar}><IconArrowRight size={21} />{queued ? "Run queued" : "Run team"}</button>
              )}
            </div>
          </header>

          <div className="context-tray" aria-label="Shared team context">
            <button className="context-item tray-heading" onClick={() => setModal("context")}>
              <strong>Context & Skills</strong><span>Available to both agents</span>
            </button>
            {memory.map((entry) => (
              <button key={entry.id} className={`context-item ${entry.id}`} onClick={() => setModal("context")}>
                <ProviderIcon agent={entry.id} size={34} />
                <span><strong>{providerNames[entry.id]} memory</strong><span>{visibleConfig.sources.includes(entry.id) ? entry.name : "Excluded"}</span></span>
              </button>
            ))}
            <button className="context-item" onClick={() => setModal("context")}>
              <IconStack2 size={35} stroke={1.45} />
              <span><strong>Shared skill</strong><span>{visibleConfig.skill ? "Regression review" : "Off"}</span></span>
            </button>
          </div>

          <div className="workbar">
            <div className="workbar-group">
              <button className="button small" onClick={() => showWorkspace("Changes")}><IconFileCode size={17} />Changes{changes > 0 && <b>{changes}</b>}</button>
              <button className="button small" onClick={() => showWorkspace("Terminal")}><IconTerminal2 size={17} />Terminal</button>
            </div>
            <div className="workbar-group">
              {pluginCount > 0 && <button className="button small" onClick={() => setModal("plugins")}><IconPuzzle size={16} />{pluginCount} active {pluginCount === 1 ? "plugin" : "plugins"}</button>}
              <button className="button small" onClick={openUsage}><IconChartBar size={17} />Usage</button>
            </div>
          </div>

          <div className="agent-board">
            <AgentLane agent="codex" turns={session.turns} usage={usage.latest.codex} openUsage={openUsage} />
            <AgentLane agent="claude" turns={session.turns} usage={usage.latest.claude} openUsage={openUsage} />
          </div>

          {approval === "patch" && (
            <div className="handoff approval" aria-live="polite">
              <IconFileCode size={23} /><span><strong>Allow Codex to edit this file?</strong><code>{files[currentStep.patch].path}</code></span>
              <div className="approval-actions">
                <button className="button small" onClick={() => showWorkspace("Changes")}>Inspect patch</button>
                <button className="button small" onClick={() => resolveApproval("skipped")}>Skip edit</button>
                <button className="button primary small" onClick={() => resolveApproval("approved")}>Approve patch</button>
              </div>
            </div>
          )}
          {handoff && approval !== "patch" && (
            <div className="handoff" aria-live="polite">
              <span className="handoff-tag"><b>Claude</b><IconArrowRight size={22} /><b>Codex</b></span>
              <span className="handoff-text">{handoff}</span>
              {approval === "handoff" && <button className="button primary small" onClick={() => resolveApproval("approved")}>Approve handoff</button>}
            </div>
          )}
          <div className="prompt-suggestions" aria-label="Sample tasks">
            <button className="button small" onClick={() => choosePrompt(prompts.retry)}>Fix duplicate retries</button>
            <button className="button small" onClick={() => choosePrompt(prompts.backoff)}>Cap backoff at 30s</button>
            <button className="button small" onClick={() => choosePrompt(prompts.review)}>Review changes</button>
            <button className="button small" onClick={() => choosePrompt(prompts.tests)}>Run tests</button>
          </div>
          {queued && (
            <div className="queued-turn" role="status"><span><strong>Up next</strong> {queued.prompt}</span><button className="icon-button" aria-label="Cancel queued message" onClick={() => setQueued(null)}><IconX size={16} /></button></div>
          )}
          <form className="composer" onSubmit={submit}>
            <IconMessage size={24} stroke={1.6} aria-hidden="true" />
            <input ref={composer} aria-label="Message both agents" placeholder={turn ? "Continue this task…" : "Tell both agents what to do…"} maxLength={300} value={message} onChange={(event) => setMessage(event.target.value)} />
            <button className="button primary small" type="submit" disabled={!message.trim() || Boolean(queued)}>{running ? "Queue message" : "Send"}<IconArrowRight size={17} /></button>
          </form>
        </section>
      </div>
      {modal === "context" && <ContextDialog config={config} setConfig={setConfig} close={close} />}
      {modal === "settings" && <SettingsDialog config={config} setConfig={setConfig} close={close} openPlugins={() => setModal("plugins")} />}
      {modal === "plugins" && <PluginsDialog config={config} setConfig={setConfig} close={close} />}
      {modal === "usage" && <UsageDialog usage={usage} close={close} />}
      {modal === "workspace" && <WorkspacePanel mode={panel} session={session} proposal={approval === "patch" ? currentStep.patch : null} close={close} selectMode={setPanel} />}
      {modal === "history" && (
        <Dialog title="Run history" close={close}>
          {session.turns.length === 0 && <p className="empty">Send a message to start the first turn.</p>}
          <div className="setting-list">
            {session.turns.map((entry, index) => (
              <div className="catalog-row" key={entry.id}>
                <span><strong>Turn {index + 1}</strong><span className="setting-detail">{entry.prompt}</span></span>
                <span className="source-pill">{entry.status}</span>
              </div>
            ))}
          </div>
          <div className="dialog-actions"><button className="button primary" onClick={close}>Done</button></div>
        </Dialog>
      )}
    </main>
  );
}
