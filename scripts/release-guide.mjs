export function releaseGuide(version, { voice = false } = {}) {
  return [
    `AI Deck ${version} — Windows x64 portable`, '',
    'Extract the entire ZIP. Close the old AI Deck, then run AI Deck.exe from the extracted folder.',
    'Connections checks your own Codex CLI and Claude Code. Sign-in stays with the original provider. No account or machine-local CLI paths are bundled.',
    'Startup checks local connections, Recents and account usage within a bounded budget. It does not send a model prompt.',
    'Recents opens the original chat. Model / Effort / Speed, permissions, text and attachments are saved per chat.',
    'Fork to Team, Fork to Codex and Fork to Claude open a new draft immediately. Send starts the selected workflow.',
    'The compact picker inside the composer chooses Codex then Claude, Claude then Codex, or a tool-free discussion. Session Team edits larger rosters.',
    'Use the attachment button to add files/images, capture a window, share one window for a turn or preview a URL. Browser and window changes require action approval.',
    'Explicit @Chrome requests to Claude use its native browser integration when the official extension/account connection is available.',
    voice ? 'Microphone transcription files are included: record Thai or English for up to 30 seconds and review before Send.'
      : 'Microphone transcription files are not included in this package. Optional local voice files are required; installed Windows voices can still read replies aloud.',
    'Independent chats can run concurrently within RAM, checkout and native-session limits. Stop belongs to the exact chat. Low RAM runs one job at a time.',
    'The primary rail contains Chat, Usage and Settings. Recents loads automatically and contains your original provider chats.',
    'Settings has thirteen categories: General, Appearance, Notifications, Accounts & connections, Voice, Models, Project, Shared knowledge, Skills & plugins, Screen & browser, Hooks, Git & worktrees, Advanced settings.',
    'General contains performance, tray, composer and keyboard controls. Appearance saves UI scale and text size separately.',
    'The X normally hides AI Deck in the tray. Use General > Quit AI Deck to save drafts and quit. A failed draft write keeps this action open so you can retry or copy your text.',
    'The update bell separates Desktop app releases from configured CLI versions. It checks metadata and opens official updater pages without installing updates automatically.',
    'Usage opens account limits first; task token reports remain separate from account quotas and billing.',
    'Advanced settings groups provider import/configuration and local data controls. Credentials stay in the original provider.',
    'Project plans carry inputs, outputs, conditions and observed evidence through the existing team chat. Reviewers start fresh; eligible builders reuse their recorded native chat.',
    'Git & worktrees previews comparisons, conflicts and checked copies. Ordinary chat never automatically commits, pushes, merges or deletes your source worktrees.',
    'Existing user data remains in the Windows AI Deck profile when changing portable versions. Keep the previous program folder for rollback; do not replace or delete the profile.',
    'Interrupted sends are restored for review without automatic replay. Refresh the original transcript before retrying an uncertain delivery.',
    'The release manifest binds packaged application files to this version. It contains relative paths and hashes, without account data.',
    'Native realtime voice, global desktop coordinate dragging/multiple-window control and Cloud writes are not implemented through this bridge. Codex Cloud reads use the official CLI.',
  ].join('\r\n');
}
