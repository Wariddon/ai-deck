export const nativeAttachmentPrefix = (id) => "[AI Deck attachments " + id + "]\n";
export function nativeAttachmentInput(prompt, requestId, images) {
  return images?.length ? nativeAttachmentPrefix(requestId) + prompt : prompt;
}
export function nativeMessageAttachments(messages, records, key) {
  const entries = new Map((records ?? []).filter((entry) => entry.sessionKey === key).map((entry) => [nativeAttachmentPrefix(entry.requestId), entry]));
  return messages.map((message) => {
    if (message.role !== "user") return message;
    const end = message.text.indexOf("\n");
    const entry = end >= 0 && entries.get(message.text.slice(0, end + 1));
    return entry ? { ...message, text: entry.prompt, images: entry.images, attachmentRequestId: entry.requestId } : message;
  });
}
