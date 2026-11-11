import { useEffect, useId, useState } from "react";
import { IconBell, IconCheck, IconExternalLink, IconRefresh } from "@tabler/icons-react";
import { Brand } from "./AgentIdentity.jsx";
import { idleRefresh } from "./idle-refresh.mjs";

export function UpdateBell({ api, ready, busy }) {
  const id = useId();
  const [updates, setUpdates] = useState({ items: [], unread: 0 });
  const [error, setError] = useState("");
  const [requesting, setRequesting] = useState(false);
  useEffect(() => {
    let disposed = false;
    void api["software-updates"]().then((result) => { if (!disposed) setUpdates(result); }).catch(() => {});
    const off = api.onEvent((event) => { if (event.type === "software-updates") setUpdates(event.updates); });
    return () => { disposed = true; off(); };
  }, [api]);
  useEffect(() => {
    if (!ready || busy) return;
    let disposed = false;
    const idle = idleRefresh(async () => {
      if (document.visibilityState !== "visible") return;
      try { const next = await api["software-updates"]({ check: true }); if (!disposed) setUpdates(next); } catch {}
    }, { delay: 1600 });
    const schedule = () => idle.request();
    const first = setTimeout(schedule, 5000), timer = setInterval(schedule, 60000);
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", schedule);
    document.addEventListener("input", idle.activity, true);
    document.addEventListener("pointerdown", idle.activity, true);
    return () => {
      disposed = true; clearTimeout(first); clearInterval(timer); idle.dispose();
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", schedule);
      document.removeEventListener("input", idle.activity, true);
      document.removeEventListener("pointerdown", idle.activity, true);
    };
  }, [api, ready, busy]);
  async function act(command, payload) {
    setError(""); setRequesting(true);
    try { setUpdates(await api[command](payload)); }
    catch { setError("Could not complete this action. Try again."); }
    finally { setRequesting(false); }
  }
  const checking = updates.checking || requesting;
  const versions = Object.fromEntries(updates.items.filter((item) => item.unread).map((item) => [item.id, item.latest]));
  return <>
    <button type="button" className="button small deck-update-bell deck-controls-trigger" aria-label={"App updates" + (updates.unread ? ": " + updates.unread + " unread" : "")}
      title="Codex and Claude updates" popoverTarget={id}>
      <IconBell size={17} aria-hidden="true" />{updates.unread > 0 && <span className="deck-update-count">{updates.unread}</span>}
    </button>
    <section id={id} popover="auto" className="deck-controls-panel deck-update-panel" aria-label="Codex and Claude updates">
      <div className="deck-update-heading"><strong>App updates</strong><button type="button" className="button small" disabled={!ready || busy || checking}
        onClick={() => act("software-updates", { check: true, force: true })}><IconRefresh size={14} className={checking ? "deck-update-spin" : undefined} />{checking ? "Checking…" : "Check now"}</button></div>
      <p className="muted">Desktop apps and the engines AI Deck uses. Updates open in the provider’s updater or guide.</p>
      {busy && <p className="muted" role="status">Checks wait until your work is idle.</p>}
      {error && <p role="alert">{error}</p>}
      {updates.items.map((item) => <article key={item.id} className="deck-update-item" data-unread={item.unread || undefined}>
        <div className="deck-update-heading"><span><Brand agent={item.provider} size={18} /><strong>{item.name}</strong></span>
          {item.status === "update" && <span className="deck-update-tag">{item.unread ? "New update" : "Update available"}</span>}</div>
        <small className="muted">{item.kind}{item.channel ? " · " + item.channel : ""}{item.bundled ? " · bundled with desktop app" : ""}</small>
        <p>{item.installed ? <>Installed {item.installed}{item.status === "update" && <> → <strong>{item.latest}</strong></>}</> : "Version not reported"}</p>
        {item.status !== "update" && <small className="muted">{item.status === "unknown" ? "Could not check this product. Open its update page or retry." : item.kind === "Desktop app" ? "No update reported by Windows." : "No newer release in this channel."}</small>}
        <div className="deck-update-footer"><small className="muted">{item.stale ? "Last known · " : ""}{item.checkedAt ? new Date(item.checkedAt).toLocaleString() : "Not checked yet"}</small>
          <button type="button" className="button small" disabled={requesting} onClick={() => act("open-software-update", item.id)}><IconExternalLink size={13} />{item.status === "update" ? "Open update" : "Update page"}</button></div>
      </article>)}
      <div className="deck-update-footer"><small className="muted">Checks every 6 hours while idle. No model tokens.</small>
        {updates.unread > 0 && <button className="button small" type="button" disabled={requesting} onClick={() => act("read-software-updates", versions)}><IconCheck size={14} />Mark read</button>}</div>
    </section>
  </>;
}
