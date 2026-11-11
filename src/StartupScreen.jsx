import { IconStack2 } from "@tabler/icons-react";
import { Brand } from "./TeamThread.jsx";

export function StartupScreen({ connections, stage }) {
  return <section className="deck-startup" aria-label="Starting AI Deck" aria-busy="true">
    <span className="deck-launch-mark" aria-hidden="true"><IconStack2 size={28} /></span>
    <strong>AI Deck</strong>
    <span className="deck-launch-status" role="status"><span className="deck-spinner" aria-hidden="true" />Preparing your workspace…</span>
    <div className="deck-startup-providers">
      {["codex", "claude"].map((agent) => {
        const connection = connections[agent];
        const pending = !connection?.status || connection.checking;
        const status = pending ? "Checking connection…" : connection.status === "ready" ? "Ready" : "Open Connections to finish setup";
        return <div key={agent}><Brand agent={agent} size={18} /><span>{agent === "codex" ? "Codex" : "Claude Code"}</span>
          <small>{pending && <span className="deck-spinner" aria-hidden="true" />}{status}</small></div>;
      })}
    </div>
    <span className="deck-launch-status">{stage === "history" ? "Loading recent chats…" : stage === "quota" ? "Reading current account usage…" : "Checking signed-in accounts…"}</span>
    <small className="deck-startup-note">Slow checks have a time limit. No model messages are sent.</small>
  </section>;
}
