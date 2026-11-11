export const nativeFilesStorageKey = "ai-deck-native-files";
const listeners = new Map();
export function subscribeNativeFiles(key, listener) {
  const group = listeners.get(key) ?? new Set(); listeners.set(key, group); group.add(listener);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); };
}
export function loadNativeFiles(storage, key) {
  try { const record = new Map(JSON.parse(storage.getItem(nativeFilesStorageKey) ?? "[]")).get(key);
    return { images: Array.isArray(record?.images) ? record.images.filter((row) => typeof row?.id === "string" && typeof row.name === "string") : [],
      version: Number.isSafeInteger(record?.version) ? record.version : 0, pending: record?.pending };
  } catch { return { images: [], version: 0 }; }
}
export function saveNativeFiles(storage, key, record, change) {
  let entries; try { entries = new Map(JSON.parse(storage.getItem(nativeFilesStorageKey) ?? "[]")); } catch { entries = new Map(); }
  // Retain a bounded empty revision too: reopening a cleared draft must not reuse
  // a version still held by an earlier async import or delivery receipt.
  entries.delete(key); entries.set(key, record);
  const empty = [...entries].filter(([, entry]) => !entry?.images?.length && !entry?.pending);
  for (const [oldKey] of empty.slice(0, Math.max(0, empty.length - 64))) entries.delete(oldKey);
  storage.setItem(nativeFilesStorageKey, JSON.stringify([...entries]));
  for (const listener of listeners.get(key) ?? []) listener(record, change);
}
export function updateNativeFiles(storage, key, update, change) {
  const before = loadNativeFiles(storage, key);
  const next = update(before);
  if (next !== before) saveNativeFiles(storage, key, next, change);
  return next;
}
