# AI Deck

AI Deck is a Windows desktop workspace for running Codex CLI and Claude Code in the same task. It includes team workflows, session roles, shared skills, usage reporting, a task inbox, and Git worktrees.

## Run on Windows

Install Git for Windows, Node.js 24, and the Codex and Claude Code CLIs. Sign in with each CLI or configure its executable from **Connections** in AI Deck.

```powershell
npm.cmd ci
npm.cmd run build
.\node_modules\.bin\electron.cmd .\desktop
```

Open a Git repository from **Projects**. Use **Team plan** beside the composer to assign roles or load a saved role preset.

## Test and package

```powershell
node --test tests/*.test.cjs tests/sites-worker.test.mjs
node scripts/package-windows.mjs
```

Run the packaging command after building. It prints the paths to the staged Windows executable and portable ZIP. CLI sign-in and workspace data are stored locally.
