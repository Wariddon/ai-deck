# Review behavioral test coverage

## Reviewer

For the changed behavior, inspect the actual assertions and the relevant existing integration coverage. Identify a material failure the tests would miss, especially rejection, invalid input, or concurrent updates when applicable. Describe the input, expected observation and why a regression would escape. A green command alone does not prove those cases were covered. Reuse matching unchanged evidence; request only the missing assertion or observation. Avoid implementation-mirroring tests and do not require tests for trivial edits.

## Source

Adapted from [Anthropic PR Test Analyzer](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/agents/pr-test-analyzer.md) as guidance for the current AI Deck reviewer. No extra reviewer is launched. See `../licenses/pr-review-toolkit-Apache-2.0.txt`.
