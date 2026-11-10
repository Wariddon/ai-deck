const { createHash, randomUUID } = require("node:crypto");
const { promises: fs, lstatSync, openSync, readSync, closeSync } = require("node:fs");
const path = require("node:path");
const { applyEdits, modify } = require("jsonc-parser");
const { parseHookToml, editHookToml } = require("./native-hook-toml.cjs");
const { protectClaudeHook } = require("./claude-hook-policy.cjs");

const maxBytes = 1024 * 1024;
const codexEvents = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest",
  "PreModelRequest", "PostModelRequest", "PreCompact", "PostCompact", "SubagentStart", "SubagentStop", "Stop", "Interrupt"];
const claudeEvents = ["SessionStart", "SessionEnd", "Setup", "UserPromptSubmit", "UserPromptExpansion", "PreToolUse",
  "PostToolUse", "PostToolUseFailure", "PostToolBatch", "PermissionRequest", "PermissionDenied", "Notification", "Stop", "StopFailure", "SubagentStart",
  "SubagentStop", "PreCompact", "PostCompact", "ConfigChange", "WorktreeCreate", "WorktreeRemove", "InstructionsLoaded",
  "TaskCreated", "TaskCompleted", "TeammateIdle", "Elicitation", "ElicitationResult", "PreModelSwitch", "PostModelSwitch",
  "CwdChanged", "DirectoryAdded", "FileChanged", "MessageDisplay"];
const events = { codex: codexEvents, claude: claudeEvents };
const samePath = (a, b) => typeof a === "string" && typeof b === "string" && path.relative(a, b) === "";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const eventKey = (event) => event.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function sourceList({ codexHome, claudeHome, repo }) {
  const source = (id, agent, label, root, relative, format = "json") =>
    ({ id, agent, label, root, filename: path.join(root, relative), format });
  const list = [
    source("codex-user-json", "codex", "Codex · User hooks.json", codexHome, "hooks.json"),
    source("codex-user-toml", "codex", "Codex · User config.toml", codexHome, "config.toml", "toml"),
    source("claude-user", "claude", "Claude Code · User settings.json", claudeHome, "settings.json"),
  ];
  if (repo) list.push(
    source("codex-project-json", "codex", "Codex · Project hooks.json", repo, ".codex/hooks.json"),
    source("codex-project-toml", "codex", "Codex · Project config.toml", repo, ".codex/config.toml", "toml"),
    source("claude-project", "claude", "Claude Code · Project settings.json", repo, ".claude/settings.json"),
    source("claude-local", "claude", "Claude Code · Project local settings.json", repo, ".claude/settings.local.json"),
  );
  return list;
}

async function statOrMissing(filename) {
  try { return await fs.lstat(filename); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function checkSourcePath(source) {
  const parent = path.dirname(source.filename);
  for (const folder of new Set([source.root, parent])) {
    const stat = await statOrMissing(folder);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error("Choose a native settings folder without redirects.");
  }
  const stat = await statOrMissing(source.filename);
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("The settings path is not a regular file.");
  if (await statOrMissing(parent)) {
    const relative = path.relative(await fs.realpath(source.root), await fs.realpath(parent));
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("The settings path leaves its source folder.");
  }
}

async function readText(filename) {
  const stat = await statOrMissing(filename);
  if (!stat) return { raw: "", exists: false, revision: "missing" };
  if (!stat.isFile() || stat.size > maxBytes) throw new Error("Use a settings file under 1 MB.");
  const file = await fs.open(filename, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) throw new Error("The settings file is too large.");
    const bytes = buffer.subarray(0, bytesRead);
    return { raw: bytes.toString("utf8"), exists: true, revision: hash(bytes) };
  } finally { await file.close(); }
}

async function readDocument(source) {
  await checkSourcePath(source);
  const file = await readText(source.filename);
  try {
    const document = decodeHookDocument(source, file.raw, file.exists);
    return { ...file, document, hooks: document.hooks ?? {} };
  } catch {
    throw new Error("The original " + source.format.toUpperCase() + " file could not be parsed. Repair it before saving Hooks.");
  }
}

function decodeHookDocument(source, raw, exists) {
  const text = raw.replace(/^\uFEFF/u, "");
  const document = source.format === "toml" ? parseHookToml(text) : exists ? JSON.parse(text) : {};
  if (!record(document) || document.hooks !== undefined && !record(document.hooks)) throw new Error("Invalid hook container");
  return document;
}

function changeJson(raw, exists, event, groups) {
  const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = exists ? raw.slice(bom.length) : "{}\n";
  const indentation = text.match(/(?:^|\n)([ \t]+)"/u)?.[1] ?? "  ";
  const format = { insertSpaces: !indentation.includes("\t"), tabSize: Math.min(indentation.length, 8), eol: text.includes("\r\n") ? "\r\n" : "\n" };
  const edits = modify(text, ["hooks", event], groups.length ? groups : undefined, { formattingOptions: format });
  return bom + applyEdits(text, edits);
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  return value;
}
const hookRevision = (hooks) => hash(JSON.stringify(stableJson(hooks)));

function nativeHookSetup(sources, claudeApprovals) {
  const entries = [];
  for (const source of sources) {
    const add = (key, label, value) => entries.push({ key: source.id + ":" + key, label: source.label + " · " + label, hash: hookRevision(value) });
    try {
      const stat = lstatSync(source.filename, { throwIfNoEntry: false });
      if (!stat) continue;
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes ||
          [source.root, path.dirname(source.filename)].some((folder) => lstatSync(folder).isSymbolicLink())) throw new Error();
      const file = openSync(source.filename, "r");
      let raw;
      try {
        const data = Buffer.alloc(stat.size + 1);
        const length = readSync(file, data, 0, data.length, 0);
        if (length !== stat.size) throw new Error();
        raw = data.toString("utf8", 0, length);
      } finally { closeSync(file); }
      const document = decodeHookDocument(source, raw, true);
      for (const event of Object.keys(document.hooks ?? {}).sort()) {
        const label = /^[a-z][a-z0-9_]{0,70}$/iu.test(event) ? event === "state" ? "Trust and enable state" : event : "Other hook settings";
        add(event, label, document.hooks[event]);
      }
      const toggle = source.agent === "codex" ? document.features?.hooks ?? document.features?.codex_hooks : document.disableAllHooks;
      if (typeof toggle === "boolean") add("setting:enabled", "Hook policy", toggle);
    } catch {
      entries.push({ key: source.id + ":unreadable", label: source.label, hash: "unreadable" });
    }
  }
  for (const id of ["claude-project", "claude-local"]) {
    if (!claudeApprovals?.[id]) continue;
    const source = sources.find((entry) => entry.id === id);
    if (source) entries.push({ key: id + ":approval", label: source.label + " · Approved for Send", hash: hookRevision(claudeApprovals[id]) });
  }
  return entries;
}

function nativeHookDifferences(before = [], current = []) {
  const previous = new Map(before.map((entry) => [entry.key, entry]));
  const changes = [];
  for (const entry of current) {
    if (entry.hash === "unreadable") changes.push("Could not verify hooks in " + entry.label + ".");
    else if (previous.get(entry.key)?.hash !== entry.hash) changes.push("Hooks changed in " + entry.label + ".");
    previous.delete(entry.key);
  }
  for (const { label, hash } of previous.values()) {
    if (hash !== "unreadable") changes.push("Hooks removed from " + label + ".");
  }
  return changes;
}

function commandHookId(event, group, handler) {
  const { hooks, ...matcher } = group;
  return hookRevision([event, matcher, handler]);
}

function claudeCommandRows(document) {
  return Object.entries(document.hooks ?? {}).flatMap(([event, groups]) => !Array.isArray(groups) ? [] :
    groups.flatMap((group) => !Array.isArray(group?.hooks) ? [] : group.hooks.flatMap((handler) =>
      handler?.type === "command" && typeof handler.command === "string" && handler.command.trim()
        ? [{ event, group, handler, id: commandHookId(event, group, handler) }] : [])));
}

function claudeHookGrant(document) {
  return { ids: [...new Set(claudeCommandRows(document).map(({ id }) => id))], pause: document.disableAllHooks ?? null };
}

async function claudeRunHooks(sources, approvals, runtime) {
  const hooks = Object.create(null);
  let paused = false;
  let skipped = 0;
  let wrapped = false;
  for (const source of sources) {
    let document;
    try { ({ document } = await readDocument(source)); }
    catch (error) {
      if (source.id === "claude-user" || approvals?.[source.id]) throw new Error(source.label + ": " + error.message);
      skipped++;
      continue;
    }
    const grant = source.id === "claude-user" ? claudeHookGrant(document) : approvals?.[source.id];
    if (typeof document.disableAllHooks === "boolean" && grant?.pause === document.disableAllHooks) paused = document.disableAllHooks;
    const ids = new Set(Array.isArray(grant?.ids) ? grant.ids : []);
    const groups = new Map();
    for (const { id, event, group, handler } of claudeCommandRows(document)) {
      if (!ids.has(id)) { skipped++; continue; }
      if (!groups.has(group)) {
        const target = { ...group, hooks: [] };
        groups.set(group, target);
        (hooks[event] ??= []).push(target);
      }
      const command = protectClaudeHook(event, handler, runtime);
      wrapped ||= command !== handler;
      groups.get(group).hooks.push(command);
    }
  }
  return { settings: !paused && Object.keys(hooks).length ? { hooks } : null, skipped, wrapped: wrapped && !paused };
}

async function atomicPrivateWrite(filename, data) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temp = filename + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temp, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await fs.rename(temp, filename);
  } finally { await fs.unlink(temp).catch(() => {}); }
}

async function readShelf(filename, hooks) {
  const file = await readText(filename);
  if (!file.exists) return { entries: [], revision: "missing" };
  let shelf;
  try { shelf = JSON.parse(file.raw); } catch { throw new Error("AI Deck could not read the disabled-hook shelf."); }
  if (!Array.isArray(shelf.entries) || shelf.pending && !Array.isArray(shelf.pending.entries)) throw new Error("The disabled-hook shelf is invalid.");
  if (!shelf.pending) return { entries: shelf.entries, revision: file.revision };
  const revision = hookRevision(hooks);
  const entries = revision === shelf.pending.after ? shelf.pending.entries : revision === shelf.pending.before ? shelf.entries : null;
  if (!entries) throw new Error("A previous hook change was interrupted and the native file changed. Both copies are preserved in " + filename);
  await atomicPrivateWrite(filename, { entries });
  return { entries, revision: (await readText(filename)).revision };
}

function readRows(source, hooks, shelf, cli) {
  const rows = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, groupIndex) => {
      if (!record(group) || !Array.isArray(group.hooks)) return;
      group.hooks.forEach((handler, index) => {
        if (!record(handler)) return;
        const suffix = ":" + eventKey(event) + ":" + groupIndex + ":" + index;
        const native = cli?.entries.find((entry) => samePath(source.filename, entry.sourcePath) && entry.key?.endsWith(suffix));
        rows.push({ id: "on:" + event + ":" + groupIndex + ":" + index, event, groupIndex, index, group, handler, native });
      });
    });
  }
  for (const item of shelf.entries) {
    if (!record(item?.group) || !record(item.handler) || typeof item.event !== "string" || typeof item.id !== "string") {
      throw new Error("The disabled-hook shelf has an unreadable entry.");
    }
    rows.push({ ...item, id: "off:" + item.id, disabled: true });
  }
  return rows;
}

function publicRow(row, source, cli) {
  const { id, event, group, handler, native, disabled } = row;
  return {
    id, event, matcher: typeof group.matcher === "string" ? group.matcher : "", type: handler.type ?? "Unknown",
    enabled: !disabled && native?.enabled !== false, status: source.agent === "codex" ? native?.trustStatus ?? "undiscovered" : disabled ? "stored" : "configured",
    canToggle: source.agent === "claude" || Boolean(cli?.version && native?.key && !native.isManaged),
    canTrust: Boolean(cli?.version && native?.currentHash && !native.isManaged && ["untrusted", "modified"].includes(native.trustStatus) && handler.type === "command"),
    canEdit: handler.type === "command" && !native?.isManaged,
    matcherEditable: disabled || group.hooks?.length === 1,
    command: typeof handler.command === "string" ? handler.command : "",
    windows: typeof (handler.commandWindows ?? handler.command_windows) === "string" ? handler.commandWindows ?? handler.command_windows : "",
    shell: typeof handler.shell === "string" ? handler.shell : "",
    args: Array.isArray(handler.args) ? handler.args : undefined,
    timeout: Number.isSafeInteger(handler.timeout) ? handler.timeout : null,
  };
}

function editCommand(source, event, previous, options) {
  const { command, windows = "", shell = "", args, timeout } = options ?? {};
  if (typeof command !== "string" || !command.trim() || command.length > 8000 || command.includes("\0")) throw new Error("Enter a command up to 8,000 characters.");
  const maxTimeout = source.agent === "codex" && ["session_end", "interrupt"].includes(eventKey(event)) ? 3 : 3600;
  if (timeout !== null && timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > maxTimeout)) {
    throw new Error("Choose a timeout from 1 to " + maxTimeout.toLocaleString("en-US") + " seconds for this event.");
  }
  const next = { ...previous, type: "command", command };
  if (timeout) next.timeout = timeout;
  else delete next.timeout;
  if (source.agent === "codex") {
    if (typeof windows !== "string" || windows.length > 8000 || windows.includes("\0")) throw new Error("Enter a valid Windows command override.");
    const field = Object.hasOwn(next, "command_windows") ? "command_windows" : "commandWindows";
    delete next.command_windows;
    delete next.commandWindows;
    if (windows) next[field] = windows;
  } else {
    if (!["", "bash", "powershell"].includes(shell)) throw new Error("Choose Bash or PowerShell.");
    if (shell) next.shell = shell;
    else delete next.shell;
    if (args !== undefined) {
      if (!Array.isArray(args) || args.length > 40 || args.some((arg) => typeof arg !== "string" || arg.length > 2000 || arg.includes("\0"))) {
        throw new Error("Arguments must be a JSON array of strings.");
      }
      next.args = args;
    } else delete next.args;
  }
  return next;
}

function setMatcher(group, matcher) {
  if (typeof matcher !== "string" || matcher.length > 1000 || /[\u0000-\u001f]/u.test(matcher)) throw new Error("Enter a single-line matcher up to 1,000 characters.");
  const next = { ...group };
  if (matcher) next.matcher = matcher;
  else delete next.matcher;
  return next;
}

function planChange(source, state, { action, rowId, options }) {
  const row = state.rows.find(({ id }) => id === rowId);
  if (action !== "add" && !row) throw new Error("Refresh Hooks and select the current definition.");
  if (action === "add") {
    if (!events[source.agent].includes(options?.event)) throw new Error("Choose a supported hook event.");
    const event = Object.keys(state.hooks).find((key) => eventKey(key) === eventKey(options.event)) ?? options.event;
    const group = setMatcher({ hooks: [editCommand(source, event, {}, options)] }, options.matcher ?? "");
    const groups = state.hooks[event] ?? [];
    if (!Array.isArray(groups)) throw new Error("This event is configured in an unsupported format.");
    return { event, groups: [...groups, group] };
  }
  if (row.native?.isManaged) throw new Error("Managed hooks follow the provider policy.");
  if (action === "trust" || action === "toggle" && source.agent === "codex") {
    if (!row.native?.key || !state.cli?.version) throw new Error("Codex must discover this hook before changing its native state.");
    const saved = state.cli.userState[row.native.key];
    const previous = typeof saved === "string" ? { trusted_hash: saved } : saved ?? {};
    if (action === "trust") {
      if (row.handler.type !== "command" || !["untrusted", "modified"].includes(row.native.trustStatus) || !row.native.currentHash) {
        throw new Error("This hook has no command revision available to trust.");
      }
      return { state: { ...state.cli.userState, [row.native.key]: { ...previous, trusted_hash: row.native.currentHash } } };
    }
    return { state: { ...state.cli.userState, [row.native.key]: { ...previous, enabled: row.native.enabled === false } } };
  }
  if (action === "edit") {
    if (row.handler.type !== "command") throw new Error("Only command hook details can be edited.");
    const handler = editCommand(source, row.event, row.handler, options);
    if (row.disabled) {
      return { entries: state.shelf.entries.map((item) => "off:" + item.id === row.id
        ? { ...item, handler, group: setMatcher(item.group, options.matcher ?? "") } : item) };
    }
    const group = row.group.hooks.length === 1 ? setMatcher(row.group, options.matcher ?? "") : { ...row.group };
    group.hooks = group.hooks.map((entry, index) => index === row.index ? handler : entry);
    return { event: row.event, groups: state.hooks[row.event].map((entry, index) => index === row.groupIndex ? group : entry) };
  }
  if (action !== "toggle" || source.agent !== "claude") throw new Error("Choose a supported hook action.");
  if (row.disabled) {
    const groups = state.hooks[row.event] ?? [];
    if (!Array.isArray(groups)) throw new Error("The original event format changed.");
    const { hooks: _handlers, ...metadata } = row.group;
    const existing = groups.findIndex((group) => record(group) && Array.isArray(group.hooks) &&
      equal(stableJson(Object.fromEntries(Object.entries(group).filter(([key]) => key !== "hooks"))), stableJson(metadata)));
    if (existing >= 0 && groups[existing].hooks.some((handler) => equal(stableJson(handler), stableJson(row.handler)))) {
      throw new Error("This hook already exists in the native file.");
    }
    const next = [...groups];
    if (existing >= 0) {
      const group = next[existing];
      const hooks = [...group.hooks];
      hooks.splice(Math.min(row.index, hooks.length), 0, row.handler);
      next[existing] = { ...group, hooks };
    } else next.splice(Math.min(row.groupIndex, next.length), 0, { ...metadata, hooks: [row.handler] });
    return { event: row.event, groups: next, entries: state.shelf.entries.filter((item) => "off:" + item.id !== row.id) };
  }
  const hooks = row.group.hooks.filter((_, index) => index !== row.index);
  const groups = state.hooks[row.event].flatMap((group, index) => index !== row.groupIndex ? [group] : hooks.length ? [{ ...group, hooks }] : []);
  const { hooks: _handlers, ...group } = row.group;
  const item = { id: randomUUID(), event: row.event, groupIndex: row.groupIndex, index: row.index, group, handler: row.handler };
  return { event: row.event, groups, entries: [...state.shelf.entries, item] };
}

function createNativeHookEditor({ profileDir, readCodexState, writeCodexState, replaceExisting }) {
  async function snapshot(source, repo) {
    const file = await readDocument(source);
    const shelfFile = path.join(profileDir, "disabled-native-hooks", hash(source.filename.toLowerCase()) + ".json");
    const shelf = source.agent === "claude" ? await readShelf(shelfFile, file.hooks) : { entries: [], revision: "" };
    const cli = source.agent === "codex" ? await readCodexState(repo).catch(() => null) : null;
    if (cli && (await readText(source.filename)).revision !== file.revision) {
      throw new Error("The hook file changed during Codex discovery. Reload Hooks.");
    }
    const rows = readRows(source, file.hooks, shelf, cli);
    const revision = hash(JSON.stringify([file.revision, shelf.revision, cli?.version,
      rows.map((row) => [row.native?.key, row.native?.enabled, row.native?.currentHash, row.native?.trustStatus])]));
    return { ...file, fileRevision: file.revision, shelfFile, shelf, cli, rows, revision };
  }

  async function replaceDocument(source, state, raw) {
    if (Buffer.byteLength(raw) > maxBytes) throw new Error("The updated settings file exceeds 1 MB.");
    await checkSourcePath(source);
    await fs.mkdir(path.dirname(source.filename), { recursive: true });
    await checkSourcePath(source);
    const temp = source.filename + ".ai-deck-" + randomUUID() + ".tmp";
    try {
      await fs.writeFile(temp, raw, { flag: "wx", mode: 0o600 });
      if (state.exists) await replaceExisting(temp, source.filename, state.fileRevision);
      else await fs.link(temp, source.filename);
    } finally { await fs.unlink(temp).catch(() => {}); }
  }

  async function change(source, repo, payload) {
    const state = await snapshot(source, repo);
    if (payload.revision !== state.revision) throw new Error("The source changed. Refresh Hooks before saving.");
    const change = planChange(source, state, payload);
    if (change.state) {
      await writeCodexState(change.state, state.cli.version);
      return;
    }
    if (!change.event) {
      await atomicPrivateWrite(state.shelfFile, { entries: change.entries });
      return;
    }
    const raw = source.format === "json" ? changeJson(state.raw, state.exists, change.event, change.groups)
      : editHookToml(state.raw, change.event, change.groups);
    const after = { ...state.hooks };
    if (change.groups.length) after[change.event] = change.groups;
    else delete after[change.event];
    if (source.format === "json") {
      const updated = JSON.parse(raw.replace(/^\uFEFF/u, ""));
      if (!equal(stableJson(updated), stableJson({ ...state.document, hooks: after }))) {
        throw new Error("AI Deck could not update just this event. The original JSON file is unchanged.");
      }
    }
    if (change.entries) {
      await atomicPrivateWrite(state.shelfFile, { entries: state.shelf.entries, pending: {
        before: hookRevision(state.hooks), after: hookRevision(after), entries: change.entries,
      } });
    }
    await replaceDocument(source, state, raw);
    if (change.entries) await atomicPrivateWrite(state.shelfFile, { entries: change.entries });
  }

  function view(source, state) {
    return { ...source, root: undefined, exists: state.exists, revision: state.revision, events: events[source.agent],
      rows: state.rows.map((row) => publicRow(row, source, state.cli)),
      sourcePaused: state.document.disableAllHooks === true };
  }
  return { snapshot, change, view };
}

module.exports = { sourceList, createNativeHookEditor, readDocument, claudeHookGrant, claudeRunHooks, nativeHookSetup, nativeHookDifferences };
