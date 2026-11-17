# Observable acceptance through normal chat

Plans already carry `readyWhen` and optional `evidenceRefs`. The existing planner and writer receive guidance automatically; there is no additional control to enable. A reference names exact files and check commands. AI Deck observes those commands when the native runner or approved required-check executor actually returns; reference text itself is never executed.

For example, a plan can require a local API response for a specific target and environment:

```json
{
  "readyWhen": ["The local health endpoint reports ready"],
  "evidenceRefs": [{
    "condition": "The local health endpoint reports ready",
    "paths": ["qa/api-result.json"],
    "checks": ["node scripts/verify-health.cjs"],
    "assertions": [
      {"path":"qa/api-result.json","pointer":"/environment","operator":"equals","value":"local"},
      {"path":"qa/api-result.json","pointer":"/target","operator":"equals","value":"http://127.0.0.1:3000/health"},
      {"path":"qa/api-result.json","pointer":"/status","operator":"equals","value":200},
      {"path":"qa/api-result.json","pointer":"/body/ready","operator":"equals","value":true}
    ]
  }]
}
```

The verifier must actually inspect that target, write the observation and return its real result. Use the target and expected values from the task, including an order or entity identity when relevant. HTTP 200 alone does not prove a business operation, delivery or deployment. Do not substitute a local observation for staging or production. AI Deck does not independently authenticate JSON claims or certify the coverage of an arbitrary verifier; reviewers still inspect its code and relevant assertions.

A build check can produce a JSON receipt with expected exports, artifact digests or version. A UI check can record actual DOM/accessible state, viewport and target/environment, with a referenced PNG, JPEG or WebP capture. AI Deck hashes the image at command completion and handoff; that binds the saved bytes, not a visual verdict. Pixel correctness needs its own actual comparison or review. Numeric measurements can use `atMost` or `atLeast` with explicit budgets from the task or a clearly proposed criterion.

The existing Handoff evidence disclosure shows:

| State | Meaning |
| --- | --- |
| verified | Exact typed JSON predicates passed with current files and a matching completed check's artifact observation. |
| evidence recorded | Referenced files/checks were recorded, without claiming every semantic requirement passed. |
| incomplete | A required artifact, valid JSON value, completed check or command-time hash is missing. |
| stale | Code or recorded artifact bytes changed after the supporting observation. |
| failed | A current check failed or an observed value did not meet its predicate. |
| unverified | A free-form condition has no machine-verifiable reference. |

Explicit incomplete, stale or failed references pause automatic queued follow-ups and final integration. Ordinary chat remains available. Repeating a passing reviewer message cannot replace missing proof. Older unbound observations remain readable as history and require a fresh check for new automation. Saved evidence describes its handoff time, not a live recheck of an external service.

Evidence collection shares one bounded file-read pass and final Git observation across contracts, then rehashes files to detect ignored or same-size edits. Per pass it reads at most twelve artifacts and four MiB total; each source/JSON file is limited to 512 KiB and each image to two MiB. Hidden/sensitive JSON, linked files and paths outside the checkout stay unavailable. Collection runs only at command completion or handoff, never on a timer, and sends no additional model requests. Runner host platform/architecture is labeled separately from the receipt's target environment.
