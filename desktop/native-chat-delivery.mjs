export function nativeChatDelivery({ prompt, previousIds, wirePrefix: prefix }, messages) {
  const index = messages.findIndex(({ id, role, text }) => role === "user" && (text === prompt || prefix && text.startsWith(prefix)) && !previousIds.has(id));
  if (index < 0) return;
  for (let newer = index - 1; newer >= 0; newer--) {
    const { id, role } = messages[newer];
    if (role === "user") break;
    if (role === "assistant" && !previousIds.has(id)) return "replied";
  }
  return "saved";
}

// Local evidence for a send survives changing the selected chat while its IPC
// response is in flight. Text alone cannot distinguish two drafts saying "Do it".
export class NativeDraftLedger {
  constructor() { this.serial = 0; this.versions = new Map(); this.pending = new Map(); }
  edited(key) {
    this.versions.delete(key);
    this.versions.set(key, ++this.serial);
    if (this.versions.size > 64) this.versions.delete(this.versions.keys().next().value);
  }
  begin(key, prompt, requestId, messages) {
    // Restored drafts have not necessarily emitted an edit in this window.
    // Give them a real token so eviction can never match two undefined tokens.
    if (!this.versions.has(key)) this.edited(key);
    const attempt = { prompt, requestId, previousIds: new Set((messages ?? []).map(({ id }) => id)), version: this.versions.get(key) };
    this.pending.delete(key);
    this.pending.set(key, attempt);
    if (this.pending.size > 16) this.pending.delete(this.pending.keys().next().value);
    return attempt;
  }
  canClear(key, attempt, draft) {
    return this.versions.get(key) === attempt.version && draft?.trim() === attempt.prompt;
  }
  receipt(key, messages, draft) {
    const attempt = this.pending.get(key);
    const status = attempt && nativeChatDelivery(attempt, messages ?? []);
    return status ? { prompt: attempt.prompt, requestId: attempt.requestId, status, discardDraft: this.canClear(key, attempt, draft) } : undefined;
  }
  finish(key, attempt) { if (this.pending.get(key) === attempt) this.pending.delete(key); }
}
