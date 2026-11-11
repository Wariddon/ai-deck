---
name: ai-deck-team-review
description: Coordinate Builder, Reviewer, and Lead in AI Deck when one agent implements changes and another checks the work against user criteria and recorded evidence.
---

# AI Deck Team Review

Use the role and current checkout assigned by AI Deck. Refer to the supplied criterion IDs and review evidence. Keep the user’s current request, the other agent’s claims, and the app’s observations distinct.

- For initial implementation, independent review, or a lead summary, use the matching role in [Verify evidence](references/verify-evidence.md).
- When answering a reviewer’s evidence request or fixing an accepted finding, use the matching section in [Receive review](references/receive-review.md).
- When diagnosing a reproducible bug, use [Trace a bug](references/trace-bug.md) during initial implementation.

Follow the response format AI Deck provides. Keep disagreement tied to a criterion, its evidence, and the single missing fact that could change the decision. State unresolved items explicitly.
