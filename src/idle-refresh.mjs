// Automatic metadata reads yield to input; explicit refresh buttons stay immediate.
export function idleRefresh(refresh, { delay = 1200, set = setTimeout, clear = clearTimeout } = {}) {
  let timer;
  let pending = false;
  let disposed = false;
  function arm() {
    if (timer !== undefined) clear(timer);
    timer = set(() => {
      timer = undefined;
      pending = false;
      if (!disposed) void refresh();
    }, delay);
  }
  return {
    request() { if (!disposed) { pending = true; arm(); } },
    activity() { if (pending && !disposed) arm(); },
    dispose() { disposed = true; pending = false; if (timer !== undefined) clear(timer); timer = undefined; },
  };
}
