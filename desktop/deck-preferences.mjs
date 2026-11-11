export const defaultDeckPreferences = {
  theme: "system", notifications: "always", attentionNotifications: false, sendOnEnter: true, voiceLanguage: "th", readReplies: true,
  localReviewRules: true, localGraphRules: true, localIntentRules: true,
};

const choices = {
  theme: ["system", "light", "dark"], notifications: ["off", "background", "always"], attentionNotifications: [false, true],
  sendOnEnter: [false, true], voiceLanguage: ["th", "en"], readReplies: [false, true],
  localReviewRules: [false, true], localGraphRules: [false, true], localIntentRules: [false, true],
};

export function normalizeDeckPreferences(value) {
  return Object.fromEntries(Object.entries(defaultDeckPreferences).map(([key, fallback]) =>
    [key, choices[key].includes(value?.[key]) ? value[key] : fallback]));
}

export function deckPreferenceChange(current, { key, value } = {}) {
  if (!Object.hasOwn(choices, key) || !choices[key].includes(value)) throw new Error("Choose a supported AI Deck preference.");
  return { ...current, [key]: value };
}
