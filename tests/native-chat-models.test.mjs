import test from "node:test";
import assert from "node:assert/strict";
import { nativeModelSettings, nativeModelStamp, normalizeNativeModels, changeNativeModels } from "../desktop/native-chat-models.mjs";
import { nativePermissionMode, changeNativePermission, nativeTurnPolicy } from "../desktop/native-chat-policy.mjs";
import { claudeArguments } from "../desktop/engines.cjs";

const codex = { provider: "codex", id: "original-chat" };
const claude = { provider: "claude", id: "original-chat" };
const catalog = { models: [
  { value: "fast-model", efforts: ["low", "medium", "high"], fast: true },
  { value: "standard-model", efforts: ["low"], fast: false },
  { value: "managed-model", efforts: [], fast: false },
] };

test("original-chat model choices are isolated by provider, native ID and canonical folder", () => {
  let saved = changeNativeModels({}, codex, "C:/plain/folder", { model: "fast-model", effort: "high", speed: "fast" }, catalog);
  saved = changeNativeModels(saved, claude, "C:/plain/folder", { model: "standard-model", effort: "low", speed: "standard" }, catalog);
  const settings = nativeModelSettings(saved, codex, "c:\\PLAIN\\folder\\");
  assert.deepEqual(settings, { model: "fast-model", effort: "high", speed: "fast" });
  assert.equal(nativeModelSettings(saved, claude, "C:/plain/folder").model, "standard-model");
  assert.deepEqual(nativeModelSettings(saved, { ...codex, id: "another-chat" }, "C:/plain/folder"), {});
  assert.deepEqual(nativeModelSettings(saved, codex, "C:/moved/folder"), {});
  settings.model = "mutated";
  assert.equal(saved["codex:original-chat"].options.model, "fast-model");
});

test("model availability, effort levels and Fast support are enforced before saving", () => {
  assert.throws(() => normalizeNativeModels("codex", { model: "unknown" }, catalog), /available model/);
  assert.throws(() => normalizeNativeModels("codex", { model: "fast-model" }), /Refresh models/);
  assert.throws(() => normalizeNativeModels("codex", { model: "standard-model", effort: "high" }, catalog), /valid model/);
  assert.throws(() => normalizeNativeModels("claude", { model: "managed-model", effort: "low" }, catalog), /valid model/);
  assert.throws(() => normalizeNativeModels("claude", { model: "standard-model", speed: "fast" }, catalog), /Fast mode/);
  assert.throws(() => normalizeNativeModels("codex", { speed: "fast" }, catalog), /supported model/);
  assert.throws(() => normalizeNativeModels("codex", { speed: "turbo" }, catalog), /valid model/);
  assert.deepEqual(normalizeNativeModels("codex", {}, catalog), {});
});

test("settings stamps detect queued or stale choices while treating Windows folder aliases equally", () => {
  const settings = { model: "fast-model", effort: "low", speed: "standard" };
  const stamp = nativeModelStamp(codex, "C:/plain/folder", settings);
  assert.equal(stamp, nativeModelStamp(codex, "c:\\plain\\folder\\", { speed: "standard", effort: "low", model: "fast-model" }));
  for (const changed of [{ ...settings, model: "other" }, { ...settings, effort: "high" }, { ...settings, speed: "fast" }]) {
    assert.notEqual(stamp, nativeModelStamp(codex, "C:/plain/folder", changed));
  }
  assert.notEqual(stamp, nativeModelStamp(claude, "C:/plain/folder", settings));
  assert.notEqual(stamp, nativeModelStamp(codex, "C:/another", settings));
});

test("clearing one chat's override preserves its permissions and other chats' choices", () => {
  const permissions = changeNativePermission({}, codex, "C:/plain", "full");
  let saved = changeNativeModels({}, codex, "C:/plain", { model: "fast-model", speed: "fast" }, catalog);
  saved = changeNativeModels(saved, claude, "C:/plain", { model: "standard-model" }, catalog);
  const cleared = changeNativeModels(saved, codex, "C:/plain", {}, catalog);
  assert.deepEqual(nativeModelSettings(cleared, codex, "C:/plain"), {});
  assert.equal(nativePermissionMode(permissions, codex, "C:/plain"), "full");
  assert.equal(nativeModelSettings(cleared, claude, "C:/plain").model, "standard-model");
});

test("saved model records remain bounded and cannot inject advanced runner settings", () => {
  let saved = {};
  for (let index = 0; index < 270; index++) saved = changeNativeModels(saved, { ...codex, id: String(index) }, "C:/plain", {}, catalog);
  assert.equal(Object.keys(saved).length, 256);
  const options = normalizeNativeModels("claude", { model: "fast-model", effort: "high", speed: "fast",
    permissionMode: "full", systemPrompt: "injected", fallbackModel: "unknown" }, catalog);
  assert.deepEqual(options, { model: "fast-model", effort: "high", speed: "fast" });
});

test("Claude original-chat choices reach CLI flags without changing session or permissions", () => {
  for (const mode of ["chat", "ask", "full"]) for (const speed of ["standard", "fast"]) {
    const settings = normalizeNativeModels("claude", { model: "fast-model", effort: "high", speed }, catalog);
    const args = claudeArguments([], "same-original-session", { ...settings, ...nativeTurnPolicy(mode).claude });
    const arg = (name) => args[args.indexOf(name) + 1];
    assert.equal(arg("--resume"), "same-original-session");
    assert.equal(arg("--model"), "fast-model"); assert.equal(arg("--effort"), "high");
    assert.equal(JSON.parse(arg("--settings")).fastMode, speed === "fast");
    assert.equal(args.includes("--fork-session"), false);
    assert.equal(arg("--permission-mode"), mode === "chat" ? "dontAsk" : mode === "full" ? "bypassPermissions" : "default");
  }
});
