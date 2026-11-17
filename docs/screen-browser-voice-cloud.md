# Screen, browser, voice and Cloud

Use ordinary chat, the existing attachment picker and the update bell. These capabilities add no Settings switch and do not copy provider credentials.

| Capability | Windows interface | Boundary |
| --- | --- | --- |
| Screenshots and accessible controls | Share up to three windows in the existing picker for one provider turn | Exact process/window identity, chat, permissions and the global computer lock remain bound; hide/minimize/Stop revokes access |
| Invoke, text, scroll, navigation keys | Existing bounded tools | Independent control IDs per window, thirty-second expiry, approval and recheck |
| Coordinate click and drag | Scoped AI Deck bridge with 0–1000 screenshot coordinates | Fresh screenshot, one-action approval and image rehash afterward; bounds, focus and covered-window checks. This is not a native Windows provider interface |
| Native Chrome | Explicit browser request to Claude, using discovered tools | Official extension/account connection; changes and tab creation require approval |
| Codex continuous conversation voice | Voice beside Send in an original Codex chat, using App Server WebRTC v3 and existing OAuth | Original thread ID, no fallback text prompt/fork. Conversation is separate from file/tool work. Navigation, hide, cancellation or ten-minute limit closes media/CLI resources |
| Claude native dictation | Native interactive CLI /voice | No supported print-mode audio API; AI Deck does not use private transcription endpoints or claim voice parity |
| Local microphone transcription | Optional Whisper files, Thai/English, thirty seconds | Review before Send; missing runtime shown honestly; no startup recording |
| Read replies aloud | Windows speech synthesis | Installed language voice; at most 1,000 reply characters |
| Codex Cloud reads | Native CLI list/status/diff | Bounded rows/detail/deadline, never creates work |
| Explicit project-chat Cloud writes | Native Codex create/apply and Claude follow-up | One-action approval and durable receipt before dispatch. Clean checkout for create/apply; original remote ID for follow-up. Codex creation requires an environment ID supplied in chat. Uncertain writes never replay |
| Native local memory | Provider-owned context and local memory, retaining opt-outs | Codex loaded-thread summaries use its native interface. No private web-account memory import or cross-provider sync |

Cloud apply binds a bounded remote diff and checkout HEAD/status/origin, then rechecks both after approval. Claude Cloud creation is interactive-only in the installed CLI, so this bridge refuses it before approval or dispatch. Create the session in Claude first and supply its ID for a native follow-up; no private provisioning API or bundled checkout upload is used. Remote creation/follow-up and local apply are excluded from the read-tool list. Missing environment IDs, unavailable providers or failed approval cause no send. Provisioning is not proof of completed code or passing tests.

Native voice negotiates through the installed CLI without exporting OAuth into the renderer. Unsupported versions/accounts fail without replay, fork or text-draft changes. A cancellation during startup fences that voice request ID. Voice uses an idle exclusive connection; ordinary independent jobs retain their bounded pool. The v3 parameter is necessary for the currently installed native WebRTC protocol.

AI Deck updates download only on request from the fixed public GitHub repository. Release tag, asset, size, SHA-256 and bounded extraction are checked before replacement. Restart flushes drafts again after download. The detached helper waits for the exact old process, preserves machine-local tools and the external profile, retains a rollback folder and restores it if replacement/launch fails. Tag publishing gates on all four Windows test shards and publishes complete assets from a draft.

Primary interfaces: [Codex App Server](https://developers.openai.com/codex/app-server), [realtime schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/realtime.rs), [Claude Cloud](https://code.claude.com/docs/en/claude-code-on-the-web), [Claude dictation](https://code.claude.com/docs/en/voice-dictation), [Claude Chrome](https://code.claude.com/docs/en/chrome). See [validation](validation.md) for controlled, live and installed proof separately.
