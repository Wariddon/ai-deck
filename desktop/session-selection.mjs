export const maxSessionSelection = 300;

export function sessionKey({ provider, repo, id }) {
  return JSON.stringify([provider ?? "deck", provider ? "" : repo, id]);
}

export function confirmedSessionSelection(payload) {
  const { confirmed, entries } = payload ?? {};
  if (confirmed !== true || !Array.isArray(entries) || !entries.length || entries.length > maxSessionSelection) {
    throw new Error("Confirm the selected chats before deleting them.");
  }
  const targets = new Map();
  for (const entry of entries) {
    if (typeof entry?.id !== "string" || !entry.id || entry.id.length > 200 ||
        (entry.provider === undefined ? typeof entry.repo !== "string" || !entry.repo || entry.repo.length > 32767 :
          !["codex", "claude"].includes(entry.provider) || entry.repo !== undefined)) {
      throw new Error("Choose valid chats from Recents.");
    }
    const { id, provider, repo } = entry;
    const target = provider ? { provider, id } : { repo, id };
    targets.set(sessionKey(target), target);
  }
  return [...targets.values()];
}
