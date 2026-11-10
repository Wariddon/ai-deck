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

module.exports = { batchDeltas };