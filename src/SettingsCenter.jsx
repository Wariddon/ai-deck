import { useEffect, useRef, useState } from "react";
import {
  IconArchive, IconBell, IconBook, IconBrandGit, IconBrowser, IconCloud, IconCode, IconDeviceDesktop,
  IconDownload, IconExternalLink, IconFolder, IconGitBranch, IconGitPullRequest, IconKey, IconKeyboard,
  IconLink, IconMicrophone, IconMouse, IconPaw, IconPlug, IconPuzzle, IconScreenshot, IconSearch, IconSettings,
  IconShield, IconShieldLock, IconSun, IconUser, IconUserShield, IconWallet,
} from "@tabler/icons-react";
import { Brand, agentNames, projectName } from "./TeamThread.jsx";
import { hookActions } from "../desktop/deck-hooks.mjs";
import "./settings-center.css";

const groups = [
  ["App", [
    ["general", "General", IconSettings, "performance memory tray enter send keyboard shortcuts hotkeys ทั่วไป"],
    ["appearance", "Appearance", IconSun, "scale text font theme dark light ขนาด ตัวอักษร"],
    ["notifications", "Notifications", IconBell, "toast alert แจ้งเตือน"],
    ["connections", "Accounts & connections", IconPlug, "cli login sign in status executables claude codex"],
    ["voice", "Voice", IconMicrophone, "mic language replies เสียง ไทย"],
  ]],
  ["Workspace", [
    ["models", "Models", IconCode, "effort speed fast fallback claude codex โมเดล"],
    ["project", "Project", IconFolder, "team plan read only shared instructions"],
    ["personalization", "Shared knowledge", IconBook, "instructions memory agents.md claude.md knowledge personalization"],
    ["plugins", "Skills & plugins", IconPuzzle, "mcp skills tools connectors"],
    ["screen", "Screen & browser", IconMouse, "desktop computer automation screenshot appshots capture chrome web url link จับภาพ ลิงก์"],
    ["hooks", "Hooks", IconLink, "events scripts commands automation"],
    ["git", "Git & worktrees", IconBrandGit, "repo branch commit staging code review diff files tests copy checkout compare combine"],
  ]],
  ["Advanced", [
    ["advanced", "Advanced settings", IconCode, "configuration toml json settings files config import sync native migration storage profile history disk data path privacy export retention นำเข้า"],
  ]],
];

const sectionHome = (section) => ({keyboard:"general",storage:"advanced",configuration:"advanced",import:"advanced",data:"advanced",computer:"screen",appshots:"screen",browser:"screen",review:"git",worktrees:"git"}[section] ?? section);

export function RequiredChecks({ workspace, busy, save }) {
  const [checks, setChecks] = useState(workspace.requiredChecks ?? []);
  const update = (index, changes) => setChecks((rows) => rows.map((row, at) => at === index ? { ...row, ...changes } : row));
  return <SettingsCard title="Project required checks"
    description="Save the PowerShell commands Auto Team must pass before reporting Ready. You can also opt in for Smart text edits. Checks run on a temporary checkout with your Windows account access.">
    <form className="native-hook-form" onSubmit={async (event) => {
      event.preventDefault();
      const next = await save(checks);
      if (next) setChecks(next.workspace.requiredChecks ?? []);
    }}>
      {checks.map((check, index) => <div className="native-hook-form" key={index}>
        <div className="native-hook-grid">
          <label className="field"><strong>Check name</strong><input required maxLength={80} value={check.name} disabled={busy}
            onChange={(event) => update(index, { name: event.target.value })} /></label>
          <SettingSelect label="Fix owner in split mode" value={check.owner} options={[["both", "Both writers"], ...Object.entries(agentNames)]}
            change={(owner) => update(index, { owner })} busy={busy} />
        </div>
        <label className="field native-hook-wide"><strong>PowerShell command</strong><input required maxLength={2000} value={check.command}
          placeholder="npm.cmd test" disabled={busy} onChange={(event) => update(index, { command: event.target.value })} /></label>
        <label className="setting-detail"><input type="checkbox" checked={check.shareResult === true} disabled={busy}
          onChange={(event) => update(index, { shareResult: event.target.checked })} /> Share the result with the next identical check if both opt in</label>
        <div className="thread-actions"><button className="button small" type="button" disabled={busy}
          onClick={() => setChecks((rows) => rows.filter((_, at) => at !== index))}>Remove check</button></div>
      </div>)}
      <div className="thread-actions">
        <button className="button small" type="button" disabled={busy || checks.length >= 6}
          onClick={() => setChecks((rows) => [...rows, { name: "", command: "", owner: "both" }])}>Add required check</button>
        <button className="button primary small" type="submit" disabled={busy}>Save required checks</button>
      </div>
    </form>
  </SettingsCard>;
}

const sections = new Map(groups.flatMap(([, entries]) => entries.map((entry) => [entry[0], entry[1]])));

export function SettingsCenter({ section, choose, feedback, children }) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const matches = groups.map(([group, entries]) => [group, entries.filter(([, label, , keywords]) =>
    words.every((word) => (label + " " + keywords).toLocaleLowerCase().includes(word)))]);
  const count = matches.reduce((total, [, entries]) => total + entries.length, 0);
  return <div className="deck-settings-center">
    <aside className="deck-settings-sidebar">
      <form className="deck-settings-search" role="search" onSubmit={(event) => {
        event.preventDefault();
        const first = matches.find(([, entries]) => entries.length)?.[1][0];
        if (query.trim() && first) choose(first[0]);
      }}>
        <IconSearch size={16} aria-hidden="true" />
        <input type="search" value={query} aria-label="Search settings" placeholder="Search settings…"
          onChange={(event) => setQuery(event.target.value)} />
      </form>
      <nav aria-label="Settings sections">
        {matches.map(([group, entries]) => entries.length > 0 && <div className="deck-settings-group" key={group}>
          <h2>{group}</h2>
          {entries.map(([key, label, Icon]) => <button key={key} type="button" aria-current={sectionHome(section) === key ? "page" : undefined}
            onClick={() => choose(key)}><Icon size={15} aria-hidden="true" />{label}</button>)}
        </div>)}
        {!count && <p className="setting-detail" role="status">No settings match your search.</p>}
      </nav>
    </aside>
    <div className="deck-settings-content">
      <h2>{sections.get(sectionHome(section))}</h2>
      {feedback}
      {children}
    </div>
  </div>;
}

export function SettingsCard({ title, description, children, scope }) {
  return <section className="deck-box deck-settings-card">
    {scope && <span className="source-pill">{scope}</span>}
    {title && <h3>{title}</h3>}
    {description && <p className="setting-detail">{description}</p>}
    {children}
  </section>;
}

export function SettingSelect({ label, value, options, change, busy, description }) {
  return <label className="field">
    <strong>{label}</strong>
    {description && <span className="setting-detail">{description}</span>}
    <select value={value} disabled={busy} onChange={(event) => change(event.target.value)}>
      {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select>
  </label>;
}

function SettingsSourceList({ sources = [], hooksOnly = false }) {
  return <div className="deck-settings-source-list">
    {sources.map(({ label, status, detected, hooks }) => <div key={label} className="deck-settings-source">
      <strong>{label}</strong>
      <span className="source-pill">{{ read: "Read", missing: "File not found", unreadable: "Couldn't read file" }[status]}</span>
      {status === "read" && (hooksOnly
        ? hooks?.length ? hooks.map(({ event, groups }) => <p className="setting-detail" key={event}>{event} · {groups} {groups === 1 ? "group" : "groups"}</p>)
          : <p className="setting-detail">No hook groups reported for this source.</p>
        : <p className="setting-detail">{detected?.length ? "Provider-owned groups · " + detected.join(", ") : "No provider-owned groups reported."}</p>)}
    </div>)}
  </div>;
}

function displaySetting(value) {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return ({ system: "Match Windows", off: "Off", background: "When AI Deck is in the background", always: "Always" })[value] ?? (value || "CLI default");
}

export function SettingsImport({ busy, action, repo }) {
  const [preview, setPreview] = useState(null);
  const [selection, setSelection] = useState([]);
  const [feedback, setFeedback] = useState("");
  const [scope, setScope] = useState("default");
  const [reading, setReading] = useState(false);
  const available = Object.values(preview?.providers ?? {}).flatMap(({ rows }) => rows?.map(({ id }) => id) ?? []);
  async function inspect() {
    setFeedback("");
    setSelection([]);
    setReading(true);
    try { setPreview(await action("preview-settings-import", { scope, repo })); }
    finally { setReading(false); }
  }
  async function apply() {
    if (await action("apply-settings-import", { token: preview.token, selection })) {
      setPreview(null);
      setSelection([]);
      setFeedback(scope === "project" ? "Selected settings saved for this project." : "Selected settings saved as AI Deck defaults.");
    }
  }
  return <SettingsCard title="Import provider settings" description="Compare settings before applying selected values in AI Deck. Project previews read the Claude Code user, project and project local files.">
    <SettingSelect label="Apply imported settings to" value={scope} busy={busy}
      options={[["default", "AI Deck default"], ...(repo ? [["project", "This project · " + projectName(repo)]] : [])]}
      change={(value) => { setScope(value); setPreview(null); setSelection([]); setFeedback(""); }} />
    <p className="setting-detail">{scope === "project" ? "Codex supplies the effective configuration for this repository. Task overrides have priority."
      : "App preferences such as theme and Windows notifications apply to this PC. Project and task overrides have priority for agent settings."}</p>
    <div className="thread-actions">
      <button className="button small" type="button" disabled={busy} onClick={inspect}>{reading ? "Reading provider settings…" : preview ? "Refresh preview" : "Preview provider settings"}</button>
      {available.length > 0 && <button className="button small" type="button" disabled={busy}
        onClick={() => setSelection(selection.length === available.length ? [] : available)}>{selection.length === available.length ? "Clear selection" : "Select all"}</button>}
      {preview && <button className="button small primary" type="button" disabled={busy || !selection.length}
        onClick={apply}>Apply selected ({selection.length})</button>}
    </div>
    {feedback && <p className="review-complete" role="status">{feedback}</p>}
    {preview && <div className="deck-import-results">
      {Object.entries(agentNames).map(([agent, name]) => {
        const source = preview.providers[agent];
        return <section key={agent} className="deck-import-source">
          <h3><Brand agent={agent} size={16} />{name}</h3>
          {source.error ? <p className="setting-detail">{source.error}</p> : <>
            {!source.rows.length && <p className="setting-detail">No compatible changes to apply for this scope.</p>}
            {source.rows.map(({ id, label, current, value, source: origin, sourceKey }) => <label className="setting-row setting-list" key={id}>
              <input type="checkbox" disabled={busy} checked={selection.includes(id)} aria-label={name + " " + label}
                onChange={(event) => setSelection(event.target.checked ? [...selection, id] : selection.filter((item) => item !== id))} />
              <span><strong>{label}</strong><span className="setting-detail deck-import-values">
                <span>AI Deck · {displaySetting(current)}</span><span>Use · {displaySetting(value)}</span>
                {origin && <span>{origin}{sourceKey ? " · " + sourceKey : ""}</span>}
              </span></span>
            </label>)}
            {source.omitted.length > 0 && <p className="setting-detail">Unavailable for this setup · {source.omitted.join(", ")}</p>}
            {source.matches?.length > 0 && <p className="setting-detail">Already matches · {source.matches.map(({ label }) => label).join(", ")}</p>}
          </>}
          <SettingsSourceList sources={source.sources} />
        </section>;
      })}
    </div>}
    {scope === "default" && <p className="setting-detail">Claude mobile push switches can be mapped to local Windows alerts. Manage phone notifications in Claude Code.</p>}
  </SettingsCard>;
}

export function SettingsInventory({ repo, busy, action, hooksOnly = false }) {
  const [result, setResult] = useState(null);
  const [reading, setReading] = useState(false);
  async function inspect() {
    setReading(true);
    try { setResult(await action("preview-settings-import", { scope: repo ? "project" : "default", repo, inventory: true, hookDetails: hooksOnly })); }
    finally { setReading(false); }
  }
  return <SettingsCard title={hooksOnly ? "Configured hooks" : "Configuration sources"}
    description={hooksOnly ? "Read hook event names and group counts. Commands stay with their original provider."
      : "Check which provider settings files are available and which groups they contain."}>
    <div><button className="button small" type="button" disabled={busy} onClick={inspect}>
      {reading ? "Reading provider configuration…" : hooksOnly ? "Inspect configured hooks" : "Inspect settings sources"}
    </button></div>
    {result && <div className="deck-import-results">
      {Object.entries(result.providers).map(([agent, source]) => <section key={agent} className="deck-import-source">
        <h3><Brand agent={agent} size={16} />{agentNames[agent]}</h3>
        {source.error && <p className="setting-detail">{source.error}</p>}
        {hooksOnly && agent === "codex" && <div className="deck-settings-source">
          <strong>Codex CLI discovery</strong>
          {source.nativeHooks?.length ? source.nativeHooks.map((hook, index) =>
            <p className="setting-detail" key={index}>{hook.eventName} · {hook.handlerType} · {hook.source} · {hook.enabled ? hook.trustStatus : "disabled"}</p>)
            : <p className="setting-detail">{source.nativeHooks ? "The CLI reported no active hook definitions." : "The CLI did not return hook trust status."}</p>}
        </div>}
        <SettingsSourceList sources={source.sources} hooksOnly={hooksOnly} />
      </section>)}
    </div>}
  </SettingsCard>;
}

export function DeckHooks({ workspace, locked, perform }) {
  const [hooks, setHooks] = useState(workspace.deckHooks ?? []);
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState("");
  const edit = (index, update) => setHooks((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...update } : row));
  return <SettingsCard title="AI Deck Git hooks" scope="This project"
    description="Run a read-only Git check before or after a provider turn. Results appear in the timeline and Run history. Choose Codex, Claude Code, or both.">
    {hooks.map((hook, index) => <div className="deck-hook-row" key={index}>
      <label className="deck-hook-enabled"><input type="checkbox" aria-label={"Enable hook " + (index + 1)} checked={hook.enabled}
        disabled={locked} onChange={(event) => edit(index, { enabled: event.target.checked })} />Enabled</label>
      <SettingSelect label="Event" value={hook.phase} busy={locked} options={[["before", "Before turn"], ["after", "After turn"]]}
        change={(phase) => edit(index, { phase })} />
      <SettingSelect label="Provider" value={hook.agent} busy={locked} options={[["both", "Both agents"], ...Object.entries(agentNames)]}
        change={(agent) => edit(index, { agent })} />
      <SettingSelect label="Check" value={hook.action} busy={locked}
        options={Object.entries(hookActions).map(([action, { label }]) => [action, label])} change={(action) => edit(index, { action })} />
      <div className="thread-actions">
        <button className="button small" type="button" disabled={locked} onClick={async () => {
          setResult(await perform("test-deck-hook", { repo: workspace.repo, action: hook.action }));
        }}>Test check</button>
        <button className="button small" type="button" disabled={locked} onClick={() => setHooks((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>
      </div>
    </div>)}
    <div className="thread-actions">
      <button className="button small" type="button" disabled={locked || hooks.length >= 8}
        onClick={() => { setNotice(""); setHooks((current) => [...current, { action: "status", phase: "before", agent: "both", enabled: true }]); }}>Add Git hook</button>
      <button className="button small primary" type="button" disabled={locked || JSON.stringify(hooks) === JSON.stringify(workspace.deckHooks ?? [])}
        onClick={async () => {
          if (await perform("save-deck-hooks", { repo: workspace.repo, hooks })) setNotice("Project hooks saved.");
        }}>Save hooks</button>
    </div>
    {notice && <p className="setting-detail" role="status">{notice}</p>}
    {result && <div><strong>{result.label} · Exit {result.code}</strong>
      <p className="setting-detail">{result.cwd}</p>{result.output && <pre className="file-preview">{result.output}</pre>}</div>}
  </SettingsCard>;
}

export function ArchivedSettings({ projects, recents, busy, pull, manage }) {
  const [query, setQuery] = useState("");
  const entries = [
    ...projects.flatMap(({ repo, tasks }) => tasks.filter(({ archived }) => archived).map((task) => ({ ...task, repo, project: projectName(repo) }))),
    ...recents.sessions.filter(({ archived }) => archived),
  ];
  const term = query.trim().toLocaleLowerCase();
  const matches = entries.filter(({ provider, title, project }) => `${agentNames[provider] ?? "AI Deck"} ${title} ${project ?? ""}`.toLocaleLowerCase().includes(term));
  return <SettingsCard description="Browse archived AI Deck tasks and archived source sessions from the last pull. Each action applies to the source shown on its row.">
    <div className="thread-actions">
      <input type="search" aria-label="Search archived chats" placeholder="Find archived chats…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button className="button small" type="button" disabled={busy || recents.loading} onClick={pull}>Pull archived sessions</button>
    </div>
    {recents.error && <p className="live-error" role="alert">{recents.error}</p>}
    {Object.entries(recents.errors ?? {}).map(([agent, error]) => <p className="setting-detail" key={agent}>{agentNames[agent]} · {error}</p>)}
    {matches.map((entry) => <button key={(entry.provider ?? "deck") + ":" + entry.id} className="deck-archive-row" type="button" disabled={busy} onClick={() => manage(entry)}>
      {entry.provider ? <Brand agent={entry.provider} size={17} /> : <IconArchive size={17} />}
      <span><strong>{entry.title}</strong><small>{agentNames[entry.provider] ?? "AI Deck"}{entry.project ? " · " + entry.project : ""}</small></span>
    </button>)}
    {!matches.length && <p className="setting-detail">{term ? "No matching archived chats." : recents.pulled ? "No archived chats found." : "Pull sessions to check the source apps."}</p>}
  </SettingsCard>;
}

export function SettingsLinks({ section, actions }) {
  if (section === "codex-cloud") return <NativeCloud actions={actions} />;
  const cards = {
    profile: ["Provider profiles", "Manage your identity and display details in the corresponding signed-in account.",
      [["ChatGPT account", "chatgpt-account"], ["Claude account", "claude-account"]]],
    parental: ["Parental controls", "Manage family settings from the ChatGPT account where they were configured.",
      [["Open ChatGPT settings", "chatgpt-account"]]],
    trusted: ["Trusted contact", "Open ChatGPT settings to manage your trusted contact if this option is available for your account.",
      [["Open ChatGPT settings", "chatgpt-account"]]],
    pets: ["Mini & Pets", "Mini and Pets are part of the ChatGPT desktop interface.",
      [["Open desktop settings guide", "codex-app-settings"]]],
    passwords: ["Provider credentials", "Manage passwords and sign-in in the corresponding account.",
      [["ChatGPT account", "chatgpt-account"], ["Claude account", "claude-account"]]],
    "cloud-computer": ["Remote environments", "Manage cloud computers and repositories in the provider's cloud workspace.",
      [["Codex Cloud", "codex-cloud"], ["Claude Code on the web", "claude-cloud"]]],
    "codex-cloud": ["Codex Cloud", "Manage cloud environments and GitHub repositories in your signed-in Codex Cloud workspace.",
      [["Open Codex Cloud", "codex-cloud"]]],
  };
  const card = cards[section];
  if (!card) return null;
  const [title, description, links] = card;
  return <SettingsCard title={title} description={description} scope="Provider">
    <div className="thread-actions">
      {links.map(([label, key]) => <button className="button small" type="button" key={key} onClick={() => actions.openProvider(key)}>{label}<IconExternalLink size={13} /></button>)}
    </div>
  </SettingsCard>;
}

function NativeCloud({ actions }) {
  const [tasks, setTasks] = useState(null), [detail, setDetail] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  async function read(payload) {
    const current = ++generation.current;
    setBusy(true); setError("");
    try {
      const value = await actions.readCloud(payload);
      if (current !== generation.current) return;
      if (value.action === "list") { setTasks(value); setDetail(null); } else setDetail(value);
    } catch (e) { if (current === generation.current) setError(e.message); }
    finally { if (current === generation.current) setBusy(false); }
  }
  return <SettingsCard title="Codex Cloud" scope="Native CLI" description="Read tasks using the signed-in Codex CLI. Create tasks and manage environments in Codex Cloud.">
    <div className="thread-actions"><button className="button small" disabled={busy} onClick={() => read({ action: "list" })}>{busy ? "Reading…" : "Refresh tasks"}</button>
      <button className="button small" onClick={() => actions.openProvider("codex-cloud")}>Open Codex Cloud<IconExternalLink size={13} /></button></div>
    {error && <p role="alert" className="deck-error">{error}</p>}
    {tasks && !tasks.tasks.length && <p className="setting-detail">No Cloud tasks were reported by this signed-in CLI account.</p>}
    {tasks?.tasks.map(task => <div className="deck-run-row" key={task.id}><div><strong>{task.title}</strong><p>{task.status} · {task.id}</p></div>
      <div className="thread-actions"><button className="button small" disabled={busy} onClick={() => read({ action: "status", id: task.id })}>Status</button>
        <button className="button small" disabled={busy} onClick={() => read({ action: "diff", id: task.id })}>Diff</button></div></div>)}
    {tasks?.more && <p className="setting-detail">Showing up to 20 tasks. Open Codex Cloud for the complete list.</p>}
    {detail && <div className="chat-markdown"><strong>{detail.action} · {detail.id}</strong><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{detail.text}</pre>
      {detail.truncated && <p className="setting-detail">Preview truncated. Open Codex Cloud for the complete result.</p>}</div>}
  </SettingsCard>;
}
