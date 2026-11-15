# Review failure visibility

## Reviewer

Trace the changed failure path through the caller, persisted state and user-visible result. Check whether a rejection or failed write can look successful, discard unsent data, leave a wait unresolved, or trigger a duplicate retry. A fallback is valid when it handles the expected case and preserves the promised behavior; do not flag every catch or optional value. Report a concrete trigger and location, its effect and the smallest missing proof or correction. Keep credentials out of diagnostic output.

## Source

Adapted from [Anthropic Silent Failure Hunter](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/agents/silent-failure-hunter.md) for changed error paths and AI Deck evidence. Original project-specific logging requirements and automatic agent dispatch are not included. See `../licenses/pr-review-toolkit-Apache-2.0.txt`.
