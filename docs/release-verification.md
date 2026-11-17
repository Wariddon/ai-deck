# Product and release verification

0.9.175 closes the ten-phase source/packaging pass. Each observation keeps its proof boundary: provider fixtures are not authentication or live inference, file hashes are not visual correctness, and local installation is not GitHub publication.

The primary rail remains Chat, Usage and Settings. Settings has thirteen categories, with infrequent tools grouped inside existing pages. General's Quit action flushes original-chat text drafts and task checkpoints, then retries retained task drafts from earlier navigation. Failed writes keep the app open with an error. This protects that action; operating-system forced termination and external process termination still use the existing recovery checkpoints.

The portable starter guide now describes the current menus and distinguishes optional microphone files from installed Windows reply voices. Packaging ignores machine-local Codex/Claude executable overrides so the ZIP cannot silently inherit its builder's paths. Recipients configure their own original CLIs and sign-in.

Packaging checks the source/desktop/README version and copied source modules, then creates `resources/app/release-manifest.json`. Its relative paths and SHA-256 values cover all application payload files except the manifest itself. Validation rejects changed/missing/extra files, symbolic/junction/hard links and known private profile files. It also records source-module/README hashes; the bundled native-hook module is validated by its packaged hash because its bytes differ from its source. This is a consistency manifest, not a digital signature or proof of malicious-code absence. The final ZIP digest is streamed and reported separately.

To verify an extracted application payload from the checkout:

```powershell
node --input-type=module -e "import {verifyRelease} from './scripts/release-verification.mjs'; console.log(verifyRelease(process.argv[1]));" 'C:\Path\AI Deck\resources\app'
```

Keep the previous program resources for rollback. The profile, drafts, settings, native conversations and managed worktrees stay in their existing locations; replacing program resources must not replace that profile. Release QA uses its own profile for version-change tests, while actual installation compares protected profile data before and after replacement/reopen.

See [validation](validation.md) for this release's thirteen-menu matrix, write failures, attachments, notifications, layouts, version changes, archive checks and installed evidence. Live Claude inference remains skipped. Optional microphone transcription, provider-native global desktop control/realtime voice and Cloud writes retain the [documented support limits](screen-browser-voice-cloud.md).
