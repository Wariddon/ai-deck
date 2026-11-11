function batchDeltas(emit) {
  const messages = new Map();
  let timer;
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    for (const { agent, event } of messages.values()) emit(agent, event);
    messages.clear();
  }
  function append(agent, event) {
    const key = agent + ":" + event.key;
    const previous = messages.get(key);
    const text = ((previous?.event.text ?? "") + event.text).slice(-30000);
    messages.set(key, { agent, event: { ...event, text } });
    timer ??= setTimeout(flush, 32);
  }
  return { append, flush };
}

function streamSummaryPreview(publish) {
  let key;
  let text = "";
  let timer;
  let lastPublished;
  return {
    update(event) {
      if (!["message", "delta"].includes(event.type) || typeof event.text !== "string") return;
      text = ((event.type === "delta" && key === event.key ? text : "") + event.text).slice(0, 2200);
      key = event.key;
      timer ??= setTimeout(() => {
        timer = undefined;
        const preview = text.trim();
        if (preview && preview !== lastPublished) {
          lastPublished = preview;
          publish(preview);
        }
      }, 40);
    },
    discard() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

module.exports = { batchDeltas, streamSummaryPreview };
