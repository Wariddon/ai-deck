import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "desktop", "package.json"), "utf8"));
const electron = path.join(root, "node_modules", "electron", "dist");
const renderer = path.join(root, "dist", "client");
if (process.platform !== "win32" || !existsSync(path.join(electron, "electron.exe")) || !existsSync(path.join(renderer, "index.html"))) {
  throw new Error("Build AI Deck and download the Windows Electron runtime before packaging.");
}

const scratch = mkdtempSync(path.join(path.dirname(root), "ai-deck-windows-"));
const stage = path.join(scratch, "AI Deck");
cpSync(electron, stage, { recursive: true });
renameSync(path.join(stage, "electron.exe"), path.join(stage, "AI Deck.exe"));
const target = path.join(stage, "resources", "app");
cpSync(path.join(root, "desktop"), target, { recursive: true });
cpSync(renderer, path.join(target, "renderer"), { recursive: true });
const htmlPath = path.join(target, "renderer", "index.html");
const csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'\">";
writeFileSync(htmlPath, readFileSync(htmlPath, "utf8").replace("<head>", "<head>\n    " + csp));

const defaults = {};
const packagedCodex = process.env.AI_DECK_CODEX_EXE;
const localClaude = path.resolve(root, "../ai-deck-tools/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe");
if (packagedCodex && existsSync(packagedCodex)) defaults.codex = packagedCodex;
if (existsSync(localClaude)) defaults.claude = localClaude;
writeFileSync(path.join(target, "local-defaults.json"), JSON.stringify(defaults, null, 2));
writeFileSync(path.join(stage, "START HERE.txt"), [
  `AI Deck ${version} — Windows x64 portable`,
  "",
  "Extract the entire ZIP, close any previous AI Deck window, then open AI Deck.exe from the new folder.",
  "Open Connections to check Codex CLI and Claude Code. Use the official CLI to sign in, then refresh.",
  "The desktop apps for Codex and Claude can be closed. AI Deck launches the local CLI executables as needed.",
  "Low RAM runs one agent CLI at a time, including schedules. It defaults on at 8 GB of RAM or less. Click Low RAM to switch and save the preference.",
  "Team settings > Device performance shows available system RAM. Turn Low RAM off to run Team agents in parallel.",
  "The X hides AI Deck in the Windows notification area. Click the tray icon to reopen. Right-click it and choose Quit AI Deck to stop the app and its scheduled tasks.",
  "With Low RAM on, an idle window releases memory after about 15 seconds in the tray. Your task draft and view come back when you reopen it. Running work and open editors keep the window loaded.",
  "To make X quit immediately, turn off Close to system tray in Team settings > Device performance.",
  "Open a repository from Projects. Use either build-and-review direction, run either agent alone, or select Team Separate edits for two independent worktrees.",
  "Click Codex or Claude Code beside the message box to choose its model, effort and speed. AI Deck saves defaults even before you open a repository. A project or task can override each agent separately.",
  "Timeline shows the shared conversation. Split opens an activity lane for each agent.",
  "Open Inspector on the right and select Outputs to view task preview links, images, observed running commands, and sources. Use + to add links or files to this task.",
  "Inspector also shows the current task's Git changes, both providers' usage, and shared context.",
  "The navigation rail opens full pages for Usage, Knowledge, Plugins, Git & Review, Scheduled and Settings. The Projects and Inspector panels can open beside the conversation.",
  "Team settings has separate sections for General, Appearance, Models, Project and Connections.",
  "Open Team plan in the composer to choose a workflow. Drag an agent to the other card or use Swap agents. Instructions stay with each role. Save for this session to reuse the assignment in new messages.",
  "Use for next message applies a role override to one send or queue entry. The composer returns to the session workflow. Role presets save a named workflow and written responsibilities.",
  "Open saved role details in the queue, run history, or handoff preview. When usage blocks a writer, the replacement receives the writer's responsibilities.",
  "In Plan to Implement, the first agent plans read-only. Review the saved plan and approve it before the second agent starts.",
  "Create or import a shared skill from Skills & plugins. Enable it for both agents in the project, or type /skill to attach it to one draft.",
  "Save a project skill to the local library, then select another project and preview the version to add. Project copies keep their instructions until you update them.",
  "Open Team inbox or type /inbox to find saved plans, pending reviews, usage handoffs and paused queues across projects.",
  "Type / for AI Deck commands such as /team-plan, /plan, /model, /review, /usage and /diff.",
  "Git & Review compares the current worktree with the last review and can draft a review of changed files. Run history keeps command results and approval decisions.",
  "Compare worktrees in Git & Review to select files from both agents and combine them in a new task. Both source worktrees stay available.",
  "Run scope lists the file and MCP tools available to each agent in the selected mode.",
  "When the project HEAD moves, Git & Review can replay tracked changes and new non-ignored files in a new task. The source worktree and staging remain available in Projects.",
  "While a run is active, Queue saves your follow-up for the next turn. Steer Codex sends a queued message to its active turn.",
  "A failed, stopped, or limited run pauses the queue. Use Run next to review changes to model, effort, shared context and permissions before sending the queued message.",
  "Steer requires the same single-agent mode and setup as the active turn. Keep other messages queued for a new turn.",
  "Review any Git or setup changes before approving a saved plan. AI Deck shows the Git result after the writer finishes. Mark implemented in Run history once you have reviewed the result.",
  "",
  "Codex starts in a detached worktree from the selected repo's committed HEAD.",
  "Build → Review starts Claude only after Codex completes and captures the worktree changes.",
  "When a builder reaches a usage limit, review the handoff and choose whether the other agent should finish the implementation in the same worktree.",
  "Refresh each account in Usage to see provider-reported quota windows, reset times and credits. Billing & invoices opens the connected provider's billing page.",
  "Codex can use an available earned reset after you confirm. Claude offers eligible resets on its account usage page. Clear AI Deck hold only changes whether AI Deck can retry the next send.",
  "Run history shows the SHA-256 and base of the review input. New source file contents are opt-in in Team settings.",
  "Context & Skills shares only the items you enable. Import committed repo instructions or write a shared note.",
  "MCP servers can be enabled per workspace and scoped to either agent or both.",
  "Usage shows CLI reports and keeps the original reporting scope for previous runs.",
  "Use Scheduled to save or enable a local cadence. Runs need AI Deck open and start from a fresh worktree at committed HEAD.",
  "New schedules start paused. Scheduled runs disable MCP tools, web search and interactive command approvals. Use the run history to inspect results.",
  "Hold this occurrence saves one waiting run. An enabled schedule resumes it when usage returns. Use Scheduled to cancel a waiting run or check usage and resume it manually.",
  "Scheduled Plan to Implement runs only the planner. Open its task to approve the handoff.",
  "Claude Plan reads files and can ask questions in chat. Review and apply a completed plan to edit in the same session.",
  "To let Claude run verification commands in Edit mode, enable the Git Bash option in Team settings and approve each command in chat.",
  "Use Feature map to see which actions AI Deck connects and which open the original provider app.",
  "Settings > Appearance adjusts UI scale and text size. Changes are saved automatically for this profile.",
  "Connections can run a short model check when you choose Test model. It consumes a small amount of provider usage.",
  "Keep draft saves the current message on this PC. When a Team provider is unavailable, choose whether to run the available agent by itself.",
  "Use Run scope to inspect shared notes and enabled tools. Codex native MCP and plugins are opt-in per project for interactive write runs.",
  "Choose review files for each draft. Review evidence records which new source files were included and flags partial input.",
  "Interactive Claude runs accept queued follow-ups, ask before edits and external tools, and can be interrupted from the timeline.",
  "Projects and Recent restore local tasks. AI Deck stores the last 24 runs and keeps older plans until you implement or dismiss them.",
  "Existing worktrees, CLI sessions and run history open as the first task of each project. New tasks get their own worktree.",
  "Project settings use the same local user data as previous releases. Sign-in stays in the official CLI.",
  "Use Open worktree to inspect or copy changes. The ZIP includes Electron; Git and both CLI executables are separate.",
].join("\r\n"));

const archiveName = `AI Deck ${version} Windows x64.zip`;
const archive = path.join(scratch, archiveName);
const archiver = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
execFileSync(archiver, ["-a", "-cf", archiveName, "AI Deck"], { cwd: scratch, windowsHide: true, stdio: "inherit" });
const outputs = path.resolve(root, "../../outputs");
mkdirSync(outputs, { recursive: true });
const deliverable = path.join(outputs, path.basename(archive));
cpSync(archive, deliverable);
console.log(JSON.stringify({ executable: path.join(stage, "AI Deck.exe"), archive: deliverable }));
