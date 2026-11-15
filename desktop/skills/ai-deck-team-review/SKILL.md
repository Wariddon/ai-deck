---
name: ai-deck-team-review
description: Coordinate AI Deck planners, builders and reviewers through scoped assignments, behavioral checks and checkout-matched evidence when agents work on a project together.
---

# AI Deck Team Review

Use the role and current checkout assigned by AI Deck. Refer to the supplied criterion IDs and review evidence. Keep the user’s current request, the other agent’s claims, and the app’s observations distinct.

- For initial implementation, independent review, or a lead summary, use the matching role in [Verify evidence](references/verify-evidence.md).
- When answering a reviewer’s evidence request or fixing an accepted finding, use the matching section in [Receive review](references/receive-review.md).
- When diagnosing a reproducible bug, use [Trace a bug](references/trace-bug.md) during initial implementation.
- For a plan or implementation handoff, use the matching role in [Plan shared work](references/plan-work.md).
- When reviewing code changes, use [Review behavioral test coverage](references/test-quality.md). For changed error paths, also use [Review failure visibility](references/silent-failures.md).

Follow the response format AI Deck provides. Keep disagreement tied to a criterion, its evidence, and the single missing fact that could change the decision. State unresolved items explicitly.

These guides apply to the members and tools AI Deck already assigned. They do not launch additional agents, widen permissions, or authorize publication. Ordinary conversation does not need these project-work guides.
