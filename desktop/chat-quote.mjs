export const maxChatQuote = 12000;

export function chatQuote(author, text) {
  if (typeof text !== "string" || !text.trim() || text.length > maxChatQuote || text.includes("\0")) {
    throw new Error("Select up to 12,000 characters from a chat message.");
  }
  const label = typeof author === "string" ? author.replace(/[^\p{L}\p{M}\p{N} ._-]/gu, "").trim().slice(0, 55) : "";
  return { name: "Quote from " + (label || "chat") + ".txt", text: text.trim() };
}
