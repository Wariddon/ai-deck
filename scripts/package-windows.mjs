import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { createWindowsStage } from "./windows-package-stage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "desktop", "package.json"), "utf8"));
const renderer = path.join(root, "dist", "client");
if (process.platform !== "win32" || process.arch !== "x64" || !existsSync(path.join(renderer, "index.html"))) {
  throw new Error("Build AI Deck on Windows x64 before packaging.");
}
const require = createRequire(import.meta.url);
const electron = path.dirname(require("electron"));
if (!existsSync(path.join(electron, "electron.exe"))) throw new Error("The Windows Electron executable is missing.");
const voice = process.env.AI_DECK_VOICE_DIR;
const voiceFiles = ["whisper-cli.exe", "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll", "LICENSE"]
  .map((file) => path.join("whisper", file)).concat(path.join("models", "ggml-base-q5_1.bin"));
if (voice && voiceFiles.some((file) => !existsSync(path.join(voice, file)))) {
  throw new Error("AI_DECK_VOICE_DIR must point to a complete Windows Whisper runtime and model folder.");
}

const { scratch, finish } = createWindowsStage(root, process.argv.includes("--keep-stage"));
const stage = path.join(scratch, "AI Deck");
cpSync(electron, stage, { recursive: true });
renameSync(path.join(stage, "electron.exe"), path.join(stage, "AI Deck.exe"));
const target = path.join(stage, "resources", "app");
const desktop = path.join(root, "desktop");
cpSync(desktop, target, { recursive: true, filter: (source) => source === desktop ||
  (path.dirname(source) === desktop && /^(?:package\.json|notification-icon\.png|[^.][^/\\]*\.(?:cjs|mjs|ps1|ico))$/u.test(path.basename(source))) });
const skill = path.join("skills", "ai-deck-team-review");
cpSync(path.join(desktop, skill), path.join(target, skill), { recursive: true });
const typescript = path.join(target, "node_modules", "typescript");
mkdirSync(path.join(typescript, "lib"), { recursive: true });
for (const file of ["package.json", "LICENSE.txt", "ThirdPartyNoticeText.txt", "lib/typescript.js"]) {
  cpSync(path.join(root, "node_modules", "typescript", file), path.join(typescript, file));
}

// Keep the document reader's Node dependency tree intact for PDF workers and native helpers.
const copiedDocumentPackages = new Set();
function copyDocumentPackage(name, from, optional = false) {
  const source = from.resolve.paths(name)?.map((folder) => path.join(folder, name))
    .find((folder) => existsSync(path.join(folder, "package.json")));
  if (!source && optional) return;
  const relative = source && path.relative(root, source);
  if (!relative?.startsWith("node_modules" + path.sep)) throw new Error("Missing local document dependency: " + name);
  if (copiedDocumentPackages.has(source)) return;
  copiedDocumentPackages.add(source);
  cpSync(source, path.join(target, relative), { recursive: true, filter: (file) =>
    path.basename(file) !== "node_modules" && !path.basename(file).startsWith("officeparser.browser.") });
  const manifest = path.join(source, "package.json");
  const { dependencies, optionalDependencies } = JSON.parse(readFileSync(manifest, "utf8"));
  const local = createRequire(manifest);
  for (const dep of Object.keys({ ...dependencies, ...optionalDependencies })) copyDocumentPackage(dep, local, Boolean(optionalDependencies?.[dep]));
}
copyDocumentPackage("officeparser", require);
const ocrData = path.join(target, "ocr-data");
mkdirSync(ocrData);
for (const code of ["tha", "eng"]) {
  const source = path.dirname(require.resolve("@tesseract.js-data/" + code));
  const filename = code + ".traineddata.gz";
  cpSync(path.join(source, "4.0.0_best_int", filename), path.join(ocrData, filename));
  cpSync(path.join(source, "README.md"), path.join(ocrData, code + "-README.md"));
}

buildSync({
  entryPoints: [path.join(root, "desktop", "native-hooks.cjs")],
  outfile: path.join(target, "native-hooks.cjs"),
  bundle: true,
  platform: "node",
  mainFields: ["module", "main"],
  format: "cjs",
  target: "node22",
});
require(path.join(target, "native-hooks.cjs"));
const hookLicenses = path.join(target, "native-hook-licenses");
mkdirSync(hookLicenses);
for (const [pkg, file] of [["jsonc-parser", "LICENSE.md"], ["toml-eslint-parser", "LICENSE"], ["eslint-visitor-keys", "LICENSE"]]) {
  cpSync(path.join(root, "node_modules", pkg, file), path.join(hookLicenses, pkg + ".txt"));
}
cpSync(renderer, path.join(target, "renderer"), { recursive: true });
const voiceTarget = path.join(target, "voice-tools");
for (const file of voice ? voiceFiles : []) {
  const destination = path.join(voiceTarget, file);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(path.join(voice, file), destination);
}
const htmlPath = path.join(target, "renderer", "index.html");
const csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src blob:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'\">";
writeFileSync(htmlPath, readFileSync(htmlPath, "utf8").replace("<head>", "<head>\n    " + csp));

const defaults = {};
for (const [agent, configured] of [["codex", process.env.AI_DECK_CODEX_EXE], ["claude", process.env.AI_DECK_CLAUDE_EXE]]) {
  if (configured && existsSync(configured)) defaults[agent] = path.resolve(configured);
}
if (Object.keys(defaults).length) writeFileSync(path.join(target, "local-defaults.json"), JSON.stringify(defaults, null, 2));
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
  "Click the waveform beside Send to start Voice chat. Choose Thai or English, record up to 30 seconds, then review the text in the composer and send. Read replies uses your installed Windows voices.",
  "Timeline shows the shared conversation. Split opens an activity lane for each agent.",
  "Open Projects > Recents > Pull sessions to browse local Codex and Claude Code conversations. Pin chats, load older messages or search within a chat.",
  "Select messages and choose Handoff to create a draft for either agent. Check the destination repo, branch and commit before creating and sending the draft.",
  "Choose Fork to Team in a native chat or its Recents menu to bring selected messages to a new AI Deck task. Pick an editable Git project and which agent builds and reviews. The original chat stays intact.",
  "Use Link conversation to continue the original Codex or Claude Code session. Choose the original checkout or an isolated copy, then switch agents in the linked conversation as needed. Keep the source idle when sending.",
  "The combined linked timeline shows both providers and recorded run evidence. Save a next step, or use Review & attach to select and preview Git diffs and command results. Open in Codex or Claude Code resumes that session in a terminal.",
  "Use the linked Shared checklist to assign and draft steps with evidence. If a provider is limited, review a handoff to the other provider beside Send.",
  "From a linked worktree copy, use Review & apply to original to preview files or select hunks. Verify the branch and confirm before applying the patch to the working files.",
  "Undo Apply previews the inverse of the latest supported patch applied from a linked copy. Git rechecks the original checkout before changing working files.",
  "Drafts are saved per task. Review recovery checks an interrupted turn and prepares a draft. Check delivery shows Git changes, open steps and reported tests, with editable commit and PR drafts.",
  "Open Inspector on the right and select Outputs to view task preview links, images, observed running commands, and sources. Use + to add links or files to this task.",
  "Inspector also shows the current task's Git changes, both providers' usage, and shared context.",
  "The usage badges next to each provider and at the bottom of the navigation rail show the highest current account quota percentage. Click a badge for the reported windows and reset times.",
  "Drag the dividers beside Projects and Inspector to resize them. Focus a divider and use the arrow keys, or double-click it to reset its width.",
  "At compact widths, panels that cannot dock open in their own view. Choose Back to chat or press Escape to return to the composer.",
  "The navigation rail opens full pages for Usage, Knowledge, Plugins, Git & Review, Scheduled and Settings. The Projects and Inspector panels can open beside the conversation.",
  "Team settings has separate sections for General, Appearance, Models, Project and Connections.",
  "Open Settings with Ctrl+, and search across Personal, Integrations and Coding. Import previews compatible Codex and Claude Code settings before applying selected defaults to AI Deck.",
  "Import can also apply project settings to the selected repository. Configuration and Hooks inspect local source groups. Claude Code push switches can be mapped to Windows completion and action alerts.",
  "Settings > Hooks can run Git status or Git diff --check before or after either provider's turn. Save project hooks and inspect their results in the timeline or Run history.",
  "Settings > Hooks also manages local Codex and Claude Code hooks. Choose a source, load its definitions, and preview the command and working folder before running a script test.",
  "Send runs enabled, trusted Codex hooks and Claude Code user scripts. Use Review for Send in Settings > Hooks to approve Claude project scripts. Run history records the hook outcomes reported by each provider.",
  "Set Auto Team required checks in Settings > Project. Auto Team runs them on a temporary checkout of the final changes and can send a failure to its assigned writer for one repair round.",
  "Use Session Team next to the composer to save ordered members, positions and models for this task. Connect Gemini with an AI Studio key or load local models from Ollama.",
  "Settings > Computer use shares one previewed Windows window with one selected agent for the next turn. Approve each control or text change in the timeline. Revoke access from the composer at any time.",
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
  "Startup checks connections, recent chats and account usage before opening the workspace. Slow checks time out without sending model prompts.",
  "Click the provider arrows below the composer to choose Codex builds then Claude reviews, the reverse order, or tool-free two-way discussion. The choice is saved per session.",
  "Settings > Appearance adjusts UI scale and text size. Changes are saved automatically for this profile.",
  "Connections can run a short model check when you choose Test model. It consumes a small amount of provider usage.",
  "Keep draft saves the current message on this PC. When a Team provider is unavailable, choose whether to run the available agent by itself.",
  "AI Deck supplies the shared context automatically. Advanced shared notes, skills and plugins are managed in Settings; files, links and screenshots share one attachment menu.",
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
try {
  renameSync(archive, deliverable);
} catch (error) {
  if (error.code !== "EXDEV") throw error;
  cpSync(archive, deliverable);
  unlinkSync(archive);
}
finish();
console.log(JSON.stringify({ executable: path.join(stage, "AI Deck.exe"), archive: deliverable }));
