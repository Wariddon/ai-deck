export const nativeTextDraftsKey = "ai-deck-native-drafts";

// Keep every unsent draft. Only empty/deleted entries may be discarded.
// Batch disk writes outside the input handler; flush on navigation and shutdown.
export class NativeTextDrafts {
  constructor(storage, { setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), delay = 200 } = {}) {
    this.storage = storage;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.delay = delay;
    this.drafts = new Map();
    this.dirty = false;
    this.timer = null;
    this.error = "";
    try {
      const rows = JSON.parse(storage.getItem(nativeTextDraftsKey) ?? "[]");
      if (!Array.isArray(rows)) throw new Error("Invalid saved draft list");
      for (const row of rows) if (Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string" && row[1])
        this.drafts.set(row[0], row[1]);
    } catch {
      this.error = "Saved chat drafts could not be read on this PC.";
    }
  }

  set(key, text) {
    if ((this.drafts.get(key) ?? "") === text) return;
    this.drafts.delete(key);
    if (text) this.drafts.set(key, text);
    this.dirty = true;
    if (!text) this.flush();
    else if (this.timer === null) this.timer = this.setTimer(() => { this.timer = null; this.flush(); }, this.delay);
  }

  delete(key) { this.set(key, ""); }

  flush() {
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
    if (!this.dirty) return !this.error;
    let error = "";
    try {
      this.storage.setItem(nativeTextDraftsKey, JSON.stringify([...this.drafts]));
      this.dirty = false;
    } catch {
      error = "Chat drafts could not be saved on this PC. Keep the app open and copy your draft before closing.";
    }
    if (this.error !== error) { this.error = error; this.onError?.(error); }
    return !error;
  }
}
