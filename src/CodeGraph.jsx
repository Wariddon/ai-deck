import { useState } from "react";
import { codeGraphQuery } from "../desktop/code-graph-query.mjs";

export const relationNames = {
  definition: "Definition", calls: "Direct call", imports: "Import", possible: "Possible call", indirect: "Indirect caller",
};

export function CodeGraph({ initial, busy, query, attach }) {
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [file, setFile] = useState(initial?.file ?? "");
  const [line, setLine] = useState(initial?.line);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const request = codeGraphQuery({ symbol, file, line, kind: "callers" });
  const resolved = result?.rows.filter((row) => row.kind === "definition") ?? [];
  async function search(kind, location = {}) {
    if (busy || !request) return;
    setError("");
    setResult(null);
    const next = await query({ ...request, ...location, kind }, setError);
    if (next) setResult(next);
  }

  return <form className="deck-code-graph" onSubmit={(event) => { event.preventDefault(); void search("callers"); }}>
    <p className="setting-detail">Scan local JavaScript and TypeScript source. Each result links a relation to its source line.</p>
    <div className="thread-handoff-fields">
      <label className="field"><strong>Symbol</strong>
        <input aria-label="Code symbol" autoFocus value={symbol} placeholder="applyLayout" maxLength={100} disabled={busy}
          onChange={(event) => { setSymbol(event.target.value); setLine(undefined); setResult(null); }} />
      </label>
      <label className="field"><strong>Definition file (optional)</strong>
        <input aria-label="Code definition file" value={file} placeholder="src/layout.ts" maxLength={300} disabled={busy}
          onChange={(event) => { setFile(event.target.value); setLine(undefined); setResult(null); }} />
      </label>
    </div>
    <div className="thread-actions">
      <button type="submit" className="button small primary" disabled={busy || !request}>Find callers</button>
      <button type="button" className="button small" disabled={busy || !request} onClick={() => void search("impact")}>Check impact</button>
    </div>
    {busy && <p role="status">Scanning the checkout…</p>}
    {error && <p className="live-error" role="alert">{error}</p>}
    {result && <section aria-label="Code graph results">
      <p className="setting-detail">{result.indexedFiles} indexed files · {result.elapsedMs} ms · {result.snapshot.slice(0, 12)}
        {result.partial && " · Partial scan or shortlist"}</p>
      {result.ambiguous && <p role="status">Several definitions match. Pick one to continue.</p>}
      {!resolved.length && <p role="status">No matching definition in the indexed files.</p>}
      {resolved.length === 1 && !result.rows.some(({ kind }) => kind === "calls") &&
        <p className="setting-detail">No direct calls resolved in this scan. Dynamic references can require a source search.</p>}
      {result.rows.map((row) => result.ambiguous ? <button type="button" className="button small" key={row.file + row.line}
        disabled={busy} onClick={() => {
          setFile(row.file);
          setLine(row.line);
          void search(result.query.kind, { file: row.file, line: row.line });
        }}>{row.file}:{row.line}</button> : <details className="code-graph-edge" key={[row.kind, row.file, row.line, row.text].join("|")}>
        <summary><span className="source-pill">{relationNames[row.kind]}</span><code>{row.file}:{row.line}</code></summary>
        <pre className="file-preview">{row.text}</pre>
      </details>)}
      {resolved.length === 1 && <div className="dialog-actions">
        <button type="button" className="button small primary" disabled={busy} onClick={() => attach({ ...result.query, file: resolved[0].file })}>
          Use in next team run
        </button>
      </div>}
    </section>}
    <p className="setting-detail">The team refreshes this query on its worktree. Imports and possible calls are shown separately from direct calls.</p>
  </form>;
}
