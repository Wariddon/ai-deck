import { useEffect, useState } from "react";
import { SettingSelect, SettingsCard } from "./SettingsCenter.jsx";

function HookForm({ view, row, busy, save, close }) {
  const codex = view.agent === "codex";
  const [event, setEvent] = useState(row?.event ?? view.events[0]);
  const [matcher, setMatcher] = useState(row?.matcher ?? "");
  const [command, setCommand] = useState(row?.command ?? "");
  const [windows, setWindows] = useState(row?.windows ?? "");
  const [shell, setShell] = useState(row?.shell ?? "");
  const [args, setArgs] = useState(row?.args === undefined ? "" : JSON.stringify(row.args));
  const [timeout, setTimeout] = useState(row?.timeout ?? "");
  const [error, setError] = useState("");
  function submit(e) {
    e.preventDefault();
    let argv;
    try {
      if (!codex && args.trim()) {
        argv = JSON.parse(args);
        if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== "string")) throw new Error();
      }
    } catch {
      setError("Enter arguments as a JSON array of strings.");
      return;
    }
    setError("");
    save({ event, matcher, command, windows, shell, args: argv, timeout: timeout === "" ? null : Number(timeout) });
  }
  return <form className="native-hook-form" onSubmit={submit}>
    <h4>{row ? "Edit command hook" : "Add command hook"}</h4>
    <div className="native-hook-grid">
      <SettingSelect label="Event" value={event} options={(row ? [row.event] : view.events).map((name) => [name, name])} change={setEvent} busy={busy || !!row} />
      <label className="field"><strong>Matcher</strong><input value={matcher} placeholder="All matches" maxLength={1000} onChange={(e) => setMatcher(e.target.value)}
        disabled={busy || row?.matcherEditable === false} /></label>
      <label className="field"><strong>Timeout (seconds)</strong><input type="number" min={1} max={3600} value={timeout}
        placeholder="Provider default" disabled={busy} onChange={(e) => setTimeout(e.target.value)} /></label>
      {!codex && <SettingSelect label="Shell" value={shell} options={[["", "Provider default"], ["bash", "Bash"], ["powershell", "PowerShell"]]}
        change={setShell} busy={busy || !!args.trim()} />}
    </div>
    {row?.matcherEditable === false && <p className="setting-detail">This matcher is shared with other hooks in the group.</p>}
    <label className="field native-hook-wide"><strong>Command</strong><textarea required rows={2} maxLength={8000} value={command} disabled={busy}
      onChange={(e) => setCommand(e.target.value)} /></label>
    {codex ? <label className="field native-hook-wide"><strong>Windows command override (optional)</strong><textarea rows={2} maxLength={8000}
      value={windows} disabled={busy} onChange={(e) => setWindows(e.target.value)} /></label>
      : <label className="field native-hook-wide"><strong>Executable arguments (optional)</strong>
        <span className="setting-detail">A JSON array runs the command as an executable with these arguments.</span>
        <textarea rows={2} maxLength={12000} value={args} disabled={busy} onChange={(e) => setArgs(e.target.value)} /></label>}
    <p className="setting-detail">{row?.status === "stored" ? "Save this definition to the disabled list." : "Save changes to the original provider file."}</p>
    {error && <p className="setting-detail" role="alert">{error}</p>}
    <div className="thread-actions"><button type="submit" disabled={busy || !command.trim()}>Save hook</button>
      <button type="button" disabled={busy} onClick={close}>Cancel</button></div>
  </form>;
}

function HookTest({ test, busy, running, result, run, cancel, close }) {
  const [input, setInput] = useState(test.input);
  return <div className="native-hook-form">
    <h4>Test script</h4>
    <p className="setting-detail">This executes the script once with your Windows permissions and the sample input below.</p>
    <dl className="native-hook-details">
      <dt>Working folder</dt><dd>{test.cwd}</dd>
      <dt>Executable</dt><dd>{test.executable}</dd>
      <dt>Command</dt><dd><code>{test.command}</code></dd>
      {test.args && <><dt>Arguments</dt><dd><code>{JSON.stringify(test.args)}</code></dd></>}
      <dt>Time limit</dt><dd>{test.timeout} seconds</dd>
    </dl>
    <label className="field native-hook-wide"><strong>Test JSON (stdin)</strong>
      <textarea rows={5} maxLength={12000} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy || result !== undefined} /></label>
    <div className="thread-actions">
      {result === undefined && !running && <button type="button" disabled={busy} onClick={() => run(input)}>Run once</button>}
      {running && <button type="button" onClick={cancel}>Cancel test</button>}
      <button type="button" onClick={close} disabled={busy}>Close preview</button>
    </div>
    {running && <p className="setting-detail" role="status">Running hook script…</p>}
    {result === null && <p className="setting-detail">Close this preview and prepare another test to retry.</p>}
    {result && <div className="native-hook-output" aria-live="polite">
      <strong>{result.reason === "timeout" ? "Timed out" : result.reason === "cancelled" ? "Cancelled" :
        result.signal ? "Signal " + result.signal : "Exit " + result.code} · {result.durationMs} ms</strong>
      <div><span>stdout</span><pre>{result.stdout || "(empty)"}</pre></div>
      <div><span>stderr</span><pre>{result.stderr || "(empty)"}</pre></div>
    </div>}
  </div>;
}

export function NativeHooks({ api, repo, locked, perform }) {
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState("codex-user-json");
  const [view, setView] = useState(null);
  const [editor, setEditor] = useState(null);
  const [test, setTest] = useState(null);
  const [trust, setTrust] = useState(null);
  const [reviewSend, setReviewSend] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    api["native-hooks-sources"]().then((items) => { if (current) setSources(items); })
      .catch(() => { if (current) setError("Could not list local hook sources."); });
    return () => { current = false; };
  }, [api]);
  const scope = { source, repo };
  const request = (name, payload) => {
    setError("");
    return perform(name, payload, setError);
  };
  function clearDetails() { setEditor(null); setTest(null); setTrust(null); setReviewSend(false); setResult(undefined); }
  function choose(id) { setSource(id); setView(null); setError(""); clearDetails(); }
  async function load() {
    clearDetails();
    const next = await request("native-hooks-read", scope);
    setView(next);
  }
  async function change(action, rowId, options) {
    const next = await request("native-hooks-change", { ...scope, revision: view.revision, action, rowId, options });
    if (next) { setView(next); clearDetails(); }
  }
  async function prepare(rowId) {
    clearDetails();
    setTest(await request("native-hook-test-preview", { ...scope, revision: view.revision, rowId }));
  }
  async function run(input) {
    setRunning(true);
    try { setResult(await request("native-hook-test-run", { token: test.token, input })); }
    finally { setRunning(false); }
  }
  return <SettingsCard title="Codex & Claude Code hooks" scope="Native settings"
    description="Load hooks from a user or project file. Save edits directly to that file, or run a saved command with sample input.">
    <div className="native-hook-source">
      <SettingSelect label="Hook source" options={sources.map(({ id, label }) => [id, label])} value={source} change={choose} busy={locked || !sources.length} />
      <div className="thread-actions">
        <button type="button" disabled={locked || !sources.length} onClick={load}>{view ? "Reload hooks" : "Load hooks"}</button>
        {view && <button type="button" disabled={locked} onClick={() => { clearDetails(); setEditor({}); }}>Add command hook</button>}
      </div>
    </div>
    {error && <p className="setting-detail" role="alert">{error}</p>}
    {view && <>
      <p className="setting-detail native-hook-path">{view.filename}{!view.exists && " · Created on first save"}</p>
      {view.agent === "codex" && <p className="setting-detail">Send runs matching, enabled hooks that Codex trusts. Open or trust the project in Codex if a project hook has no reported state.</p>}
      {view.agent === "claude" && <p className="setting-detail">Enabled user scripts run on Send. Project scripts need a review below. Disable stores the hook here and Enable restores it to the original file.</p>}
      {view.sourcePaused && <p className="setting-detail" role="status">This file has disableAllHooks enabled.</p>}
      {view.projectRun && <div className="native-hook-form">
        <h4>Claude project scripts on Send</h4>
        <p className="setting-detail">{view.projectRun.ready} of {view.projectRun.count} active definitions reviewed for this project.</p>
        {!reviewSend && <div className="thread-actions">
          {view.projectRun.needsReview && <button type="button" disabled={locked} onClick={() => { clearDetails(); setReviewSend(true); }}>Review for Send</button>}
          {view.projectRun.approved && <button type="button" disabled={locked} onClick={() => change("revoke-send")}>Revoke for Send</button>}
        </div>}
        {reviewSend && <>
          <p className="setting-detail">Approve these definitions for future sends from this project. Scripts run with your Windows account access.</p>
          {view.rows.filter((row) => row.type === "command" && row.enabled && row.command.trim()).map((row) => <div key={row.id}>
            <strong>{row.event} · {row.matcher || "All matches"}</strong>
            <pre>{row.command}{row.args && "\n" + JSON.stringify(row.args)}</pre>
          </div>)}
          <div className="thread-actions"><button type="button" disabled={locked} onClick={() => change("approve-send")}>Approve for Send</button>
            <button type="button" disabled={locked} onClick={() => setReviewSend(false)}>Cancel</button></div>
        </>}
      </div>}
      {editor && <HookForm key={editor.row?.id ?? "new"} view={view} row={editor.row} busy={locked}
        save={(options) => change(editor.row ? "edit" : "add", editor.row?.id, options)} close={() => setEditor(null)} />}
      {trust && <div className="native-hook-form">
        <h4>Trust this Codex hook revision?</h4>
        <p className="setting-detail">{trust.event} · {trust.matcher || "All matches"}</p>
        <pre>{trust.command}</pre>{trust.windows && <pre>{trust.windows}</pre>}
        <div className="thread-actions"><button type="button" disabled={locked} onClick={() => change("trust", trust.id)}>Trust this revision</button>
          <button type="button" disabled={locked} onClick={() => setTrust(null)}>Cancel</button></div>
      </div>}
      {test && <HookTest key={test.token} test={test} result={result} busy={locked} running={running} run={run}
        cancel={() => api["native-hook-test-cancel"]().catch(() => setError("Could not cancel the test."))} close={() => setTest(null)} />}
      <div className="native-hook-list">
        {!view.rows.length && <p className="setting-detail">No hooks in this source.</p>}
        {view.rows.map((row) => <div className="native-hook-row" key={row.id}>
          <div className="native-hook-summary">
            <div><strong>{row.event}</strong> <span className="source-pill">{row.type}</span>{" "}
              <span className="source-pill">{row.status === "undiscovered" ? "State unavailable" : row.enabled ? "Enabled" : "Disabled"}</span>
              {view.agent === "codex" && row.status !== "undiscovered" && <span className="source-pill">{row.status}</span>}</div>
            {row.matcher && <span className="setting-detail">Matches {row.matcher}</span>}
            {row.command && <code title={row.command}>{row.command}</code>}
          </div>
          <div className="thread-actions">
            {row.canEdit && <button type="button" disabled={locked} onClick={() => { clearDetails(); setEditor({ row }); }}>Edit</button>}
            {row.canToggle && <button type="button" disabled={locked} onClick={() => change("toggle", row.id)}>{row.enabled ? "Disable" : "Enable"}</button>}
            {row.type === "command" && (row.command || row.windows) && <button type="button" disabled={locked} onClick={() => prepare(row.id)}>Test script</button>}
            {row.canTrust && <button type="button" disabled={locked} onClick={() => { clearDetails(); setTrust(row); }}>Review trust</button>}
          </div>
        </div>)}
      </div>
    </>}
    <p className="setting-detail">Automatic local script hooks apply when you send a task. Provider-managed hooks follow provider policy. Scheduled tasks use the AI Deck Git checks.</p>
  </SettingsCard>;
}
