const { test } = require("node:test");
const assert = require("node:assert/strict");
const { authenticationConnection } = require("../desktop/provider-auth.cjs");

test("a terminal expired OAuth failure replaces a misleading stored sign-in without losing reconnect metadata", () => {
  const connection = { status: "ready", path: "claude.exe", version: "2.1.259", command: "claude auth login", plan: "pro" };
  const result = { status: "failed", error: "Failed to authenticate: OAuth session expired and could not be refreshed" };
  const changed = authenticationConnection(connection, result);
  assert.equal(changed.status, "signIn");
  assert.match(changed.authError, /will not resend automatically/u);
  for (const key of ["path", "version", "command", "plan"]) assert.equal(changed[key], connection[key]);
  assert.equal(connection.status, "ready");
  assert.equal(authenticationConnection(undefined, result), undefined);
});

test("assistant quotes, tool failures, limits, permission denials and transport errors do not sign out a provider", () => {
  const connection = { status: "ready" };
  for (const result of [
    { status: "completed", answer: "Failed to authenticate: OAuth session expired and could not be refreshed" },
    { status: "completed", error: "Failed to authenticate: OAuth session expired and could not be refreshed" },
    { status: "interrupted", error: "Failed to authenticate: OAuth session expired and could not be refreshed" },
    { status: "limited", error: "API usage limit reached" },
    { status: "failed", error: "403 Forbidden: this project is not authorized" },
    { status: "failed", error: "Connection reset. Try again later." },
    { status: "failed", error: "The build failed: OAuth login component test" },
    { status: "failed" },
  ]) assert.equal(authenticationConnection(connection, result), connection);
  for (const error of ["401 Unauthorized: invalid API key", "OAuth token has expired. Please log in again."])
    assert.equal(authenticationConnection(connection, { status: "failed", error }).status, "signIn");
});
