// Metadata only: never installs software, authenticates, or sends a model prompt.
export const updateProducts = [
  { id: "codex-app", provider: "codex", name: "Codex desktop", kind: "Desktop app", packageId: "9PLM9XGG6VKS", source: "msstore", url: "ms-windows-store://pdp/?ProductId=9PLM9XGG6VKS" },
  { id: "claude-app", provider: "claude", name: "Claude desktop", kind: "Desktop app", packageId: "Anthropic.Claude", source: "winget", url: "https://claude.com/download" },
  { id: "codex-cli", provider: "codex", name: "Codex CLI", kind: "AI Deck engine", url: "https://learn.chatgpt.com/docs/codex/cli" },
  { id: "claude-cli", provider: "claude", name: "Claude Code", kind: "AI Deck engine", url: "https://code.claude.com/docs/en/setup#update-manually" },
];
const ids = new Set(updateProducts.map(({ id }) => id));
const cacheMs = 6 * 3600000;
// Windows App Execution Aliases can be executable while stat() returns EACCES.
// The fallback is only the caller's fixed, per-user Windows Package Manager alias.
export function updateExecutable(name, locate, windowsPackageManager) {
  return locate(name) || (name === "winget" ? windowsPackageManager : undefined);
}
export function softwareVersion(value) {
  if (typeof value !== "string" || value.length > 180) return null;
  const match = value.trim().match(/^(?:codex-cli\s+|v)?(\d+\.\d+\.\d+(?:\.\d+)?)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?(?:\s+\(Claude Code\))?$/);
  if (!match || match[1].split(".").every((n) => Number(n) === 0)) return null;
  return { text: match[1] + (match[2] ? "-" + match[2] : ""), core: match[1].split(".").map(Number), pre: match[2]?.split(".") ?? [] };
}
export function compareSoftwareVersions(a, b) {
  a = softwareVersion(a); b = softwareVersion(b);
  if (!a || !b) return null;
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
    const n = (a.core[i] ?? 0) - (b.core[i] ?? 0);
    if (n) return Math.sign(n);
  }
  if (!a.pre.length || !b.pre.length) return Number(!a.pre.length) - Number(!b.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    return xn && yn ? Math.sign(Number(x) - Number(y)) : xn !== yn ? (xn ? -1 : 1) : (x < y ? -1 : 1);
  }
  return 0;
}
export function parseWindowsPackage(output, packageId) {
  const clean = String(output).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const line of clean.split(/[\r\n]+/)) {
    const words = line.trim().split(/\s+/), index = words.indexOf(packageId);
    if (index < 0) continue;
    const installed = softwareVersion(words[index + 1])?.text;
    if (!installed) continue;
    const latest = softwareVersion(words[index + 2])?.text;
    return { installed, latest: latest ?? null };
  }
  return null;
}
const npmSources = {
  codex: "https://registry.npmjs.org/-/package/@openai%2fcodex/dist-tags",
  claude: "https://registry.npmjs.org/-/package/@anthropic-ai%2fclaude-code/dist-tags",
};
async function packageTags(fetcher, provider, signal) {
  const response = await fetcher(npmSources[provider], { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), redirect: "error", credentials: "omit" });
  if (!response.ok) throw new Error("Version catalog unavailable");
  const reader = response.body.getReader();
  let size = 0, parts = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64 * 1024) throw new Error("Version catalog too large");
      parts.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); }
}
export function createUpdateReader({ capture, executable, claudeChannel = async () => "latest", fetcher = fetch, platform = process.platform }) {
  return async (signal) => {
    const items = [];
    // Serial local processes keep this small on low-RAM machines.
    for (const product of updateProducts) {
      signal.throwIfAborted();
      let installed, latest, channel, bundled = false;
      try {
        if (product.packageId) {
          const winget = platform === "win32" && executable("winget");
          if (!winget) throw new Error("Windows update catalog unavailable");
          const read = await capture(winget, ["list", "--id", product.packageId, "--exact", "--source", product.source, "--disable-interactivity"], { signal, timeout: 12000, limit: 128 * 1024 });
          const parsed = read.code === 0 && parseWindowsPackage(read.stdout, product.packageId);
          if (!parsed) throw new Error("This app was not reported by the Windows catalog");
          ({ installed, latest } = parsed);
        } else {
          const exe = executable(product.provider);
          if (!exe) throw new Error("AI Deck engine not configured");
          // Read the selected binary again: its updater may have replaced it
          // since the last sign-in check, even when the path stays the same.
          const read = await capture(exe, ["--version"], { signal, timeout: 7000, limit: 4096 });
          installed = read.code === 0 && softwareVersion(read.stdout.trim())?.text;
          if (!installed) throw new Error("Installed engine version unavailable");
          bundled = /(?:WindowsApps|[\\/]resources[\\/])/i.test(exe);
          channel = product.provider === "claude" ? await claudeChannel() : "latest";
          const tags = await packageTags(fetcher, product.provider, signal);
          latest = softwareVersion(tags[channel])?.text;
          if (!latest || softwareVersion(latest).pre.length) throw new Error("Release version unavailable");
        }
        signal.throwIfAborted();
        items.push({ id: product.id, installed, latest, channel, bundled, status: latest && compareSoftwareVersions(latest, installed) > 0 ? "update" : "current", checkedAt: Date.now() });
      } catch {
        signal.throwIfAborted();
        // Do not relay raw command output, paths, or environment data to the UI.
        items.push({ id: product.id, installed: installed || undefined, channel, bundled, status: "unknown", checkedAt: Date.now() });
      }
    }
    return items;
  };
}

export function createUpdateMonitor({ saved = {}, read, persist, changed = () => {}, canCheck = () => true, now = Date.now }) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
  let data = { items: [], readVersions: {}, lastChecked: 0, retryAt: 0 }, pending, controller;
  for (const item of Array.isArray(saved.items) ? saved.items.slice(0, 4) : []) {
    if (!ids.has(item?.id) || data.items.some((other) => other.id === item.id)) continue;
    const installed = softwareVersion(item.installed)?.text, latest = softwareVersion(item.latest)?.text;
    data.items.push({ id: item.id, installed, latest, bundled: item.bundled === true,
      channel: updateProducts.find((product) => product.id === item.id).packageId ? undefined : item.channel === "stable" ? "stable" : "latest",
      status: installed && latest && compareSoftwareVersions(latest, installed) > 0 ? "update" : item.status === "current" && installed ? "current" : "unknown",
      checkedAt: Number(item.checkedAt) || 0, stale: Boolean(item.stale) });
  }
  for (const id of ids) if (softwareVersion(saved.readVersions?.[id])) data.readVersions[id] = softwareVersion(saved.readVersions[id]).text;
  for (const field of ["lastChecked", "retryAt"]) data[field] = Number.isFinite(saved[field]) ? Math.min(saved[field], now() + cacheMs) : 0;
  function view() {
    const items = updateProducts.map(({ id, name, kind, provider, source }) => {
      const item = data.items.find((row) => row.id === id) ?? { id, status: "unknown" };
      const expired = Boolean(item.installed) && (!Number.isFinite(item.checkedAt) || item.checkedAt <= 0 || item.checkedAt > now() + 60000 || now() - item.checkedAt >= cacheMs);
      return { ...item, stale: Boolean(item.stale || expired), name, kind, provider, source: source ? "Windows catalog" : "Publisher package catalog", unread: item.status === "update" && data.readVersions[id] !== item.latest };
    });
    return { items, checking: Boolean(pending), unread: items.filter((item) => item.unread).length, lastChecked: data.lastChecked };
  }
  function commit(next) { persist(structuredClone(next)); data = next; changed(view()); }
  function markRead(versions) {
    const readVersions = { ...data.readVersions };
    for (const item of data.items) if (item.status === "update" && versions?.[item.id] === item.latest) readVersions[item.id] = item.latest;
    commit({ ...data, readVersions });
    return view();
  }
  function check({ force = false } = {}) {
    if (pending) return pending;
    if (!canCheck() || !force && now() < (data.retryAt || data.lastChecked + cacheMs)) return Promise.resolve(view());
    const own = controller = new AbortController();
    pending = Promise.resolve().then(() => read(own.signal)).then((items) => {
      own.signal.throwIfAborted();
      const stamp = now(), failed = items.some((item) => item.status === "unknown");
      const merged = items.map((item) => {
        const old = data.items.find((old) => old.id === item.id && old.installed);
        if (item.status !== "unknown" || !old) return item;
        if (item.channel && old.channel && item.channel !== old.channel) return item;
        // A newly installed version invalidates an old update alert even if
        // the remote catalog is temporarily offline.
        if (item.installed && old.latest && compareSoftwareVersions(item.installed, old.latest) >= 0) return item;
        return { ...old, installed: item.installed || old.installed, stale: true };
      });
      commit({ ...data, items: merged, lastChecked: stamp, retryAt: failed ? stamp + 15 * 60000 : 0 });
    }).catch((error) => {
      if (!own.signal.aborted) commit({ ...data, retryAt: now() + 15 * 60000, items: data.items.map((item) => ({ ...item, stale: true })) });
    }).finally(() => { if (controller === own) { controller = null; pending = null; changed(view()); } }).then(view);
    changed(view());
    return pending;
  }
  return { view, check, markRead, abort() { controller?.abort(); } };
}
