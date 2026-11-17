export function nativeHistoryCursor(provider, value) {
  if (value === null) return null;
  if (provider === "codex" && typeof value === "string" && value.length > 0 && value.length <= 2048) return value;
  if (provider === "claude" && value && !Array.isArray(value) && Number.isSafeInteger(value.end) && value.end >= 0 &&
      (value.discard === undefined || typeof value.discard === "boolean")) {
    return { end: value.end, ...(value.discard !== undefined && { discard: value.discard }) };
  }
  throw new Error("Refresh this chat before loading older messages.");
}

// Latest pages are newest first. Preserve the oldest loaded boundary separately
// from the fresh page's cursor; refresh and delivery must not rewind pagination.
export function mergeNativeLatest(current, next) {
  const old = current.messages ?? [], fresh = next.messages ?? [];
  const complete = next.hasOlder === false && !next.skipped;
  const samePrefix = fresh.length <= old.length && fresh.every((row, index) => JSON.stringify(row) === JSON.stringify(old[index]));
  let messages;
  if (samePrefix && (!complete || fresh.length === old.length)) messages = old;
  else if (complete) messages = fresh;
  else {
    const ids = new Set(fresh.map(({ id }) => id));
    messages = [...fresh, ...old.filter(({ id }) => !ids.has(id))];
  }
  const extended = !complete && (current.historyExtended || messages.length > fresh.length);
  const preserveCursor = extended && Object.hasOwn(current, "cursor");
  const { delivered, outcome, ...previous } = current;
  return { ...previous, ...next, messages, historyExtended: Boolean(extended),
    ...(preserveCursor && { cursor: current.cursor, hasOlder: current.hasOlder }),
    skipped: Boolean(next.skipped || !complete && current.skipped) };
}

export function mergeNativeOlder(current, next) {
  const old = current.messages ?? [], ids = new Set(old.map(({ id }) => id));
  const added = (next.messages ?? []).filter(({ id }) => !ids.has(id));
  return { ...current, ...next, messages: added.length ? [...old, ...added] : old,
    historyExtended: true, skipped: Boolean(current.skipped || next.skipped) };
}
