# Screen, browser, voice and Cloud

Ordinary chat keeps the existing attachments, window sharing and explicit browser request flow. This phase adds no feature switches, extra model turns or replacement provider sessions.

| Capability | AI Deck Windows interface | Boundary |
| --- | --- | --- |
| Screenshot or inspect one shared window | Existing attachment preview, then per-turn window lease | Scoped to its provider/chat and verified window; hide/minimize/Stop revokes access |
| Accessible invoke, text, scroll and navigation keys | Existing bounded window tools | Fresh inspection within 30 seconds; one action approval; recheck after approval |
| Chrome/Edge browser automation | Claude Code native Chrome tools for an explicit browser request | Official extension/account connection required; changes and tab creation ask for approval even with full file permissions |
| Browser dragging or several browser tabs | Native browser tools only when discovered and approved | Does not grant global desktop dragging or access to unshared desktop windows |
| Native desktop coordinates or simultaneous desktop windows | No supported bridge in this Windows runner | No emulation through unrestricted shell commands or fabricated tool support |
| Microphone to chat | Existing local Whisper transcription, up to 30 seconds, Thai/English | Optional runtime required; review transcript before Send; not native realtime voice |
| Read a reply aloud | Windows speech synthesis and existing audio player | Installed language voice required; at most 1,000 reply characters |
| Codex Cloud | Official signed-in CLI list/status/diff | Read-only; 20 task rows, 16k detail preview, 18-second caller deadline; no exec/apply/delete |
| Other cloud actions or realtime provider voice | Original provider surface | No hidden writes, authentication automation or new session in ordinary chat |

The native browser connection is distinct from a running Chrome process or a connected MCP server. Claude must read `list_connected_browsers` before using it, and report missing connections without repeated model attempts. An English code phrase such as `edge cases`, `knowledge` or `chromeOptions` must not enable Chrome. Native `tabs_context_mcp` with `createIfEmpty` can mutate browser state and therefore requires approval.

Window observations expire instead of authorizing an action indefinitely. Closing access interrupts pending approval waits. Independent controllers never share control IDs; every actual action still verifies its bound window identity. Browser-native requests retain their discovered tools and per-action permissions. This release does not introduce an additional window picker or bypass the global computer lock.

Voice helper cancellation and deadlines await cleanup of owned processes. A transcription/speech result from another task or project is rejected, even if it completes late or the two projects contain the same saved task ID. Minimize cancels backend voice preparation as well as window sharing. No microphone prompt, recording or playback is started at launch.

The current provider documentation describes Claude Code computer use as a macOS interactive-session preview, unavailable through Windows CLI/non-interactive print mode. Its Desktop Windows feature is a separate surface. See [Claude Code computer use](https://code.claude.com/docs/en/computer-use) and [native Chrome integration](https://code.claude.com/docs/en/chrome). Codex Cloud uses the documented [official CLI commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli); metadata reads do not create cloud work.

See [validation](validation.md) for controlled fixtures, actual local-tool checks, installed release status and remaining live-provider proof.
