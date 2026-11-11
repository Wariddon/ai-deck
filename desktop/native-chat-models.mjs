import { createHash } from "node:crypto";
import { catalogModel, normalizeAgentSettings } from "./agent-settings.mjs";
import { nativeFolderKey } from "./native-chat-policy.mjs";

export function nativeModelSettings(saved, session, cwd) {
  const record = saved?.[session.provider + ":" + session.id];
  if (!cwd || nativeFolderKey(record?.cwd) !== nativeFolderKey(cwd)) return {};
  return Object.fromEntries(["model", "effort", "speed"].filter((key) => typeof record.options?.[key] === "string" && record.options[key])
    .map((key) => [key, record.options[key]]));
}

export function nativeModelStamp(session, cwd, options) {
  return createHash("sha256").update(JSON.stringify([session.provider, session.id, nativeFolderKey(cwd),
    ...["model", "effort", "speed"].map((key) => options?.[key] || "")])).digest("hex");
}

export function normalizeNativeModels(provider, options, catalog) {
  if (!["codex", "claude"].includes(provider) || !options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Choose model settings for this original chat.");
  }
  const selected = Object.fromEntries(["model", "effort", "speed"].map((key) => [key, options[key] ?? ""]));
  if (selected.model && (!catalog || !catalogModel(catalog, selected.model))) {
    throw new Error("Refresh models and choose an available model for this chat.");
  }
  if (selected.speed === "fast" && !selected.model) throw new Error("Choose a supported model before enabling Fast.");
  const normalized = normalizeAgentSettings(provider, selected, catalog);
  return Object.fromEntries(["model", "effort", "speed"].filter((key) => normalized[key]).map((key) => [key, normalized[key]]));
}

export function changeNativeModels(saved, session, cwd, options, catalog) {
  if (!session.id || !cwd) throw new Error("Refresh this original chat's folder before saving models.");
  const normalized = normalizeNativeModels(session.provider, options, catalog);
  const key = session.provider + ":" + session.id;
  const records = Object.entries(saved ?? {}).filter(([id]) => id !== key).slice(-255);
  return Object.fromEntries([...records, [key, { cwd, options: normalized }]]);
}
