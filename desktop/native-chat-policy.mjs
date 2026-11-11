import { permissionModes } from "./run-permissions.mjs";

export const nativePermissionModes = ["chat", ...permissionModes];

export function nativeFolderKey(cwd) {
  if (typeof cwd !== "string" || !cwd) return "";
  const normalized = cwd.replaceAll("\\", "/").replace(/\/$/u, "");
  return /^(?:[a-z]:|\/\/)/iu.test(normalized) ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function nativePermissionMode(saved, session, cwd) {
  const record = saved?.[session.provider + ":" + session.id];
  return cwd && nativeFolderKey(record?.cwd) === nativeFolderKey(cwd) && nativePermissionModes.includes(record?.mode) ? record.mode : "chat";
}

export function changeNativePermission(saved, session, cwd, mode) {
  if (!["codex", "claude"].includes(session.provider) || typeof session.id !== "string" || !session.id || !cwd ||
      !nativePermissionModes.includes(mode)) throw new Error("Choose a valid permission for this original chat.");
  const key = session.provider + ":" + session.id;
  const records = Object.entries(saved ?? {}).filter(([id]) => id !== key).slice(-255);
  return Object.fromEntries([...records, [key, { cwd, mode }]]);
}

export function nativeTurnPolicy(mode) {
  if (!nativePermissionModes.includes(mode)) throw new Error("Refresh the chat permissions before sending.");
  const readOnly = mode === "chat";
  return { readOnly, permissionMode: mode, claude: { interactive: !readOnly, role: readOnly ? "test" : "write", allowCommands: !readOnly,
    permissionMode: mode, ...(!readOnly && { systemPrompt: nativeWorkInstructions(mode) }) } };
}

export function nativeWorkInstructions(mode) {
  return "This is a continuation of the same original chat in AI Deck. For this turn, file and command tools are enabled with " +
    ({ ask: "user approval", auto: "the provider's automatic approval reviewer", full: "Full access" }[mode] ?? "user approval") +
    ". Earlier chat-only restrictions no longer describe the available tools. Use the tools actually provided for the user's current request; " +
    "do not claim tools are unavailable because of older messages. Inspect current state before changes and preserve unrelated work. " +
    "Answer in the user's language. Do not repeat actions from old messages unless the current request calls for them.";
}
