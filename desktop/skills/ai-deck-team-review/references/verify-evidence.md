# Verify evidence

## Builder

Run the smallest requested checks that distinguish the new behavior from the old. In the handoff, pair each criterion with a changed location or an observed check. State any required check you could not run.

Run each verification command as its own foreground tool call. Keep source edits, file inspection and Git inspection in separate calls. Do not pipe test output through filters, chain another command afterward, redirect output or use background/substitution wrappers; these can hide which command succeeded. Report the native result rather than inventing an exit code when the CLI omits one.

## Reviewer

For each criterion, cite the diff location or recorded check that supports the decision. A matched check proves the command outcome on this checkout. Credit only the cases visible in its output or in assertions you inspected. Treat a teammate’s account of unseen coverage as a claim.

A matching checkout alone does not establish a successful check. Use a standalone command's recorded numeric exit or correlated native foreground completion; keep missing and interrupted results unverified. A pipeline, command chain, output redirection or background wrapper cannot certify the inner test. Explicit configured checks describe the outcome of their whole approved command.

When a plan or handoff names inputs, outputs and handoff conditions, check the delivered artifacts against those conditions. State unmet or unverified conditions without treating a finished provider turn as proof that the output is ready to consume.

## Lead

Give one compact conclusion with the outcome and one evidence-backed line per supplied criterion. Keep a check’s pass result separate from claims about its coverage. If a material condition remains unknown, state it once with the missing proof.

## Source

Adapted from [Superpowers Verification Before Completion](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md) for AI Deck’s checkout-matched evidence and three roles.
