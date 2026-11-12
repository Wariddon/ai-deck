import { useState } from "react";
import {
  IconBook, IconChartBar, IconExternalLink, IconGitPullRequest,
  IconHome2, IconLayoutGrid, IconPuzzle, IconSettings,
} from "@tabler/icons-react";
import { agentNames } from "./TeamThread.jsx";

const pages = [
  ["workspace", "Workspace", IconHome2],
  ["usage", "Usage", IconChartBar],
  ["settings", "Settings", IconSettings],
];

export function DeckNav({ current, go, footer }) {
  return <nav className="deck-nav" aria-label="AI Deck">
    {pages.map(([key, label, Icon]) => <button type="button" className="icon-button" key={key} aria-label={label}
      title={label}
      aria-current={current === key ? "page" : undefined} onClick={() => go(key)}><Icon size={19} />
    </button>)}
    {footer && <div className="deck-nav-footer">{footer}</div>}
  </nav>;
}

export function WorkbenchPage({ title, description, scope, actions, children, hidden = false }) {
  return <section className="deck-page deck-workbench" aria-label={title} hidden={hidden}>
    <header className="deck-page-heading">
      <div>{scope && <p className="deck-kicker">{scope}</p>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
      {actions && <div className="thread-actions deck-page-actions">{actions}</div>}
    </header>
    {children}
  </section>;
}

export function ProjectEmpty({ message, choose, busy }) {
  return <div className="deck-box deck-project-empty">
    <h2>Open a project</h2><p className="setting-detail">{message}</p>
    <button className="button primary" disabled={busy} onClick={choose}>Open repository</button>
  </div>;
}

const features = {
  team: [
    ["Timeline, Split, queue and run history", "In AI Deck", "Projects and per-task worktrees"],
    ["Low RAM", "In AI Deck", "Run the agent CLIs one at a time and check available system memory"],
    ["Build → Review in either direction", "In AI Deck", "The second agent reviews the captured diff"],
    ["Questions and usage handoff", "In AI Deck", "Answer either agent in chat and choose to continue an interrupted build with the other agent"],
    ["Parallel edits", "In AI Deck", "One worktree per writer · compare patches in Changes"],
    ["Knowledge, SKILL.md and HTTP MCP", "In AI Deck", "Project scope and explicit enabled sources"],
    ["Images, PDF, Word, Excel and OCR", "In AI Deck", "Attach to team tasks or original Recents chats. Scanned PDFs use local Thai and English OCR."],
    ["Shared source evidence", "In AI Deck", "Both providers can read numbered source lines and search files in the exact task folder, including reviewers."],
    ["Window capture and Computer Use", "In AI Deck", "Preview and share one Windows or Chrome window for a turn. Screenshots and accessible controls; each UI change needs approval."],
    ["Native cloud and account memory", "Provider apps", "Provider-hosted memory, cloud workspaces and native artifacts stay in their original services."],
  ],
  codex: [
    ["Resume, Steer, command and patch approvals", "In AI Deck", "Native Codex App Server"],
    ["Model, reasoning effort and speed", "In AI Deck", "Open Codex beside the message box. Account limits are in Usage."],
    ["Cloud task list, status and diff", "In AI Deck", "Read from the signed-in Codex CLI in Settings → Codex Cloud. Create and apply cloud work in Codex Cloud.", "codex-cloud"],
    ["Goal and fork", "In AI Deck", "Native goal control and conversation fork into a fresh worktree"],
    ["Original chats, attachments and window sharing", "In AI Deck", "Continue the same Codex chat from Recents. Choose its own permissions, model, effort and speed."],
    ["Native browser, desktop plugins and Dot", "Provider app", "These native app integrations remain in the original app", "codex-cloud"],
  ],
  claude: [
    ["Resume, review, plan and edit", "In AI Deck", "Apply a completed plan in the same Claude session"],
    ["Run tests with approval", "In AI Deck", "Enable Git Bash requests for Claude Edit in Team settings"],
    ["Model, effort, speed, fallback and output style", "In AI Deck", "Open Claude Code beside the message box."],
    ["Account-level usage and local hooks", "In AI Deck", "Read reported quota and manage, test or enable local provider hooks in Settings."],
    ["Original chats, attachments and window sharing", "In AI Deck", "Continue the same Claude Code chat from Recents with its own permissions and model settings."],
    ["Claude in Chrome", "Native CLI", "Ask Claude to inspect Chrome or mention @Chrome. Native extension and sign-in required; browser changes ask for approval."],
    ["Native subagents, checkpoint / rewind and plugin marketplace", "Provider app", "Open Claude Desktop or its Code tab", "claude-desktop"],
    ["Remote Control and cloud scheduled tasks", "Provider app", "Open Claude Code in the browser", "claude-cloud"],
    ["Claude Chat, Cowork and Artifacts", "Provider app", "Open Claude's original interface", "claude-desktop"],
  ],
};

export function FeatureMap({ go, openProvider, error }) {
  const [scope, setScope] = useState("team");
  return <WorkbenchPage title="Feature map" scope="AI Deck" description="Browse Team, Codex and Claude capabilities.">
    {error && <p className="live-error" role="alert">{error}</p>}
    <div className="thread-segments deck-scope" role="group" aria-label="Feature scope">
      {Object.entries({ team: "Team", ...agentNames }).map(([key, label]) => <button key={key} aria-pressed={scope === key}
        onClick={() => setScope(key)}>{label}</button>)}
    </div>
    <div className="deck-tool-grid deck-feature-grid">
      {features[scope].map(([title, status, description, destination]) => <article className="deck-box deck-feature" key={title}>
        <div><h3>{title}</h3><p>{description}</p></div>
        {destination ? <button className="button small" onClick={() => openProvider(destination)}><IconExternalLink size={14} />{status}</button>
          : <span className="source-pill">{status}</span>}
      </article>)}
    </div>
    <button className="button small deck-scope" onClick={() => go("settings")}>Open settings</button>
  </WorkbenchPage>;
}
