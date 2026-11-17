// Bound the caller even if a metadata reader does not acknowledge cancellation.
// Its eventual rejection is still handled and a late value cannot be published.
function abortableRead(read, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (complete, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort); complete(value);
    };
    const abort = () => finish(reject, signal.reason);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return read(); }).then(
      value => signal.aborted ? abort() : finish(resolve, value),
      error => finish(reject, signal.aborted ? signal.reason : error),
    );
  });
}

module.exports = { abortableRead };
