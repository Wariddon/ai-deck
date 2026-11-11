import test from "node:test";
import assert from "node:assert/strict";
import { changeNativePermission, nativePermissionMode, nativeTurnPolicy } from "../desktop/native-chat-policy.mjs";
import { codexPermissions } from "../desktop/run-permissions.mjs";
import { claudeArguments } from "../desktop/engines.cjs";
import { nativeChatEvent } from "../src/native-chat-events.mjs";

test("original chat permissions stay separate by provider, ID and canonical folder, including no-Git folders", () => {
  const session = { provider: "codex", id: "session-one" };
  assert.equal(nativePermissionMode({}, session, "C:/plain-folder"), "chat");
  let saved = changeNativePermission({}, session, "C:/plain-folder", "full");
  assert.equal(nativePermissionMode(saved, session, "c:\\PLAIN-FOLDER\\"), "full");
  assert.equal(nativePermissionMode(saved, { ...session, provider: "claude" }, "C:/plain-folder"), "chat");
  assert.equal(nativePermissionMode(saved, { ...session, id: "session-two" }, "C:/plain-folder"), "chat");
  assert.equal(nativePermissionMode(saved, session, "C:/other-folder"), "chat");
  assert.equal(nativePermissionMode(saved, session, null), "chat");
  saved = changeNativePermission(saved, { ...session, provider: "claude" }, "C:/plain-folder", "ask");
  assert.equal(nativePermissionMode(JSON.parse(JSON.stringify(saved)), session, "C:/plain-folder"), "full");
  assert.throws(() => changeNativePermission(saved, session, "C:/plain-folder", "allow-all"));
  assert.throws(() => nativeTurnPolicy("allow-all"));
  const unix = changeNativePermission({}, session, "/Home/user", "full");
  assert.equal(nativePermissionMode(unix, session, "/home/user"), "chat");
});

test("native permission choices configure actual Codex sandbox and Claude tools on the same persistent session", () => {
  const expected = { ask: "default", auto: "auto", full: "bypassPermissions" };
  for (const mode of ["chat", "ask", "auto", "full"]) {
    const policy = nativeTurnPolicy(mode);
    const codex = codexPermissions(mode, "C:/plain-folder", policy.readOnly, policy.readOnly);
    assert.equal(codex.sandbox, mode === "full" ? "danger-full-access" : mode === "chat" ? "read-only" : "workspace-write");
    assert.equal(codex.approvalsReviewer, mode === "auto" ? "auto_review" : "user");
    const args = claudeArguments([], "native-same-session", policy.claude);
    const value = (key) => args[args.indexOf(key) + 1];
    assert.equal(value("--resume"), "native-same-session");
    assert.equal(args.includes("--fork-session"), false);
    assert.equal(args.includes("--no-session-persistence"), false);
    assert.equal(value("--permission-mode"), mode === "chat" ? "dontAsk" : expected[mode]);
    assert.equal(value("--tools").split(",").includes("Bash"), mode !== "chat");
    assert.equal(value("--tools").split(",").includes("Edit"), mode !== "chat");
    assert.equal(args.includes("--append-system-prompt"), mode !== "chat");
  }
});

test("native activity replaces updates, bounds memory, and resolves controls at turn end", () => {
  let state = nativeChatEvent({}, { type: "activity", key: "tool", text: "Started" });
  state = nativeChatEvent(state, { type: "activity", key: "tool", text: "Done" });
  assert.deepEqual(state.steps, [{ key: "tool", text: "Done" }]);
  for (let index = 0; index < 120; index++) state = nativeChatEvent(state, { type: "activity", key: index, text: "Step" });
  assert.equal(state.steps.length, 80);
  state = nativeChatEvent(state, { type: "approval", key: "request-one", text: "Write" });
  state = nativeChatEvent(state, { type: "control-resolved", key: "wrong-request", decision: "Approved once" });
  assert.equal(state.controls[0].decision, undefined);
  state = nativeChatEvent(state, { type: "finished" });
  assert.equal(state.controls[0].decision, "Turn ended");
  state = nativeChatEvent(state, { type: "window-share-started", title: "Shared QA window" });
  assert.equal(state.windowEnded, false);
  state = nativeChatEvent(state, { type: "window-share-ended" });
  assert.equal(state.windowEnded, true);
  assert.equal(state.windowTitle, "Shared QA window");
});
