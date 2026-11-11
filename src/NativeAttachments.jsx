import { useCallback, useEffect, useRef, useState } from "react";
import { IconPaperclip, IconX } from "@tabler/icons-react";
import { sessionKey } from "../desktop/session-selection.mjs";
import { ControlPopover } from "./ControlPopover.jsx";
import { WindowAttachment } from "./SessionTools.jsx";
import { loadNativeFiles, subscribeNativeFiles, updateNativeFiles } from "./native-files-draft.mjs";

export function useNativeAttachments({ api, session, busy, onEdited, onDelivered, canEdit }) {
  const key = sessionKey(session), native = { provider: session.provider, id: session.id };
  const record = useRef(null); if (!record.current) record.current = loadNativeFiles(localStorage, key);
  const [images, setImages] = useState(record.current.images), [adding, setAdding] = useState(false), [error, setError] = useState("");
  const [panel, setPanel] = useState(null), [windows, setWindows] = useState([]), [loadingWindows, setLoadingWindows] = useState(false);
  const [shared, setShared] = useState(null);
  const sharedRef = useRef(null); sharedRef.current = shared;
  const [progress, setProgress] = useState("");
  const dialog = useRef(null), mounted = useRef(true);
  const writer = useRef(Symbol()), editedCallback = useRef(onEdited); editedCallback.current = onEdited;
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false;
    if (sharedRef.current) void api["computer-revoke"](sharedRef.current.token).catch(() => {});
  }; }, [api]);
  useEffect(() => {
    const sync = (next, change) => {
      record.current = next; setImages(next.images);
      if (change?.kind === "edit" && change.writer !== writer.current) editedCallback.current();
    };
    const stop = subscribeNativeFiles(key, sync);
    sync(loadNativeFiles(localStorage, key));
    return stop;
  }, [key]);
  useEffect(() => { if (panel && !dialog.current?.open) dialog.current?.showModal(); }, [panel]);
  useEffect(() => api.onEvent((event) => {
    if (event.type === "attachment-ocr" && event.native?.provider === native.provider && event.native.id === native.id)
      setProgress([event.name, event.stage, event.page && "Page " + event.page].filter(Boolean).join(" · "));
  }), [api, native.provider, native.id]);
  useEffect(() => {
    if (!shared) return;
    const timeout = setTimeout(() => setShared(null), Math.max(0, shared.expires - Date.now()));
    return () => clearTimeout(timeout);
  }, [shared]);
  function persist(update, kind) {
    try {
      const next = updateNativeFiles(localStorage, key, update, { kind, writer: writer.current });
      record.current = next; if (mounted.current) setImages(next.images);
      return next;
    } catch { if (mounted.current) setError("Could not save this attachment draft on this PC. Keep this chat open and retry."); return null; }
  }
  function edited() {
    // Text edits need one durable invalidation after a send, not a rewrite of
    // every chat's file ledger on each keystroke.
    const current = record.current;
    if (current.pending && current.version === current.pending.version)
      persist(latest => latest.pending && latest.version === latest.pending.version ? { ...latest, version: latest.version + 1 } : latest, "text");
  }
  function editFiles(update) {
    const result = persist(latest => ({ ...latest, images: update(latest.images), version: latest.version + 1 }), "edit");
    if (result && mounted.current) editedCallback.current();
  }
  function add(rows) { if (rows?.length) editFiles(current => [...current, ...rows.filter(row => !current.some(old => old.id === row.id))]); }
  async function importFiles(command, files) {
    if (busy || adding) return;
    setAdding(true); setError(""); setProgress("");
    try { const rows = await api[command]({ native, existing: record.current.images, files }); add(rows); }
    catch (reason) { if (mounted.current) setError(String(reason.message ?? reason)); }
    finally { if (mounted.current) setAdding(false); }
  }
  async function preview(image) {
    setError(""); try { const value = await api["preview-task-attachment"](image.id); if (mounted.current) setPanel({ kind: "preview", name: image.name, ...value }); }
    catch (reason) { setError(String(reason.message ?? reason)); }
  }
  async function refreshWindows() {
    setLoadingWindows(true); setError("");
    try { setWindows(await api["capture-windows"]({ native })); } catch (reason) { setError(String(reason.message ?? reason)); }
    finally { setLoadingWindows(false); }
  }
  function capture(share = false) { setPanel({ kind: "capture", share }); void refreshWindows(); }
  const thumbnail = useCallback(async (id) => (await api["preview-task-attachment"]({ id, thumbnail: true })).source, [api]);
  function begin(requestId, prompt) {
    const next = persist(latest => ({ ...latest, pending: { requestId, prompt, version: latest.version } }), "send");
    if (!next) throw new Error("Could not save this attachment draft. Free local storage before sending.");
    return next;
  }
  function delivered(messages) {
    const current = record.current, pending = current.pending;
    if (!pending || current.version !== pending.version || !messages?.some((row) => row.attachmentRequestId === pending.requestId)) return;
    const next = persist(latest => latest.pending?.requestId === pending.requestId && latest.version === pending.version
      ? { images: [], version: latest.version + 1 } : latest, "receipt");
    if (next && !next.pending) onDelivered(pending.prompt);
  }
  return { images, adding, error, progress, edited, begin, delivered, capture, thumbnail, preview, shared,
    revoke() { if (shared) void api["computer-revoke"](shared.token).catch(() => {}); if (mounted.current) setShared(null); },
    remove(id) { if (!busy) editFiles(current => current.filter(row => row.id !== id)); },
    paste(event) {
      const files = [...event.clipboardData.files];
      if (files.length) { event.preventDefault(); void importFiles("import-task-files", files); }
      else if (!event.clipboardData.getData("text/plain") && !event.clipboardData.types.includes("text/html")) void importFiles("paste-clipboard-files");
    },
    drop(event) { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); void importFiles("import-task-files", [...event.dataTransfer.files]); } },
    controls: <ControlPopover title="Attach to original chat" label="" icon={<IconPaperclip size={15} />} disabled={busy || adding}>
      <button className="button small" type="button" disabled={busy || adding} onClick={() => importFiles("choose-task-attachments")}>Files &amp; images</button>
      <button className="button small" type="button" disabled={busy || adding} onClick={() => capture(false)}>Screenshot</button>
      <button className="button small" type="button" disabled={busy || adding} onClick={() => capture(true)}>Share a window</button>
    </ControlPopover>,
    dialog: panel && <dialog ref={dialog} className="native-attachment-dialog" aria-label={panel.kind === "capture" ? "Capture a window" : "Attachment preview"} onCancel={() => setPanel(null)}>
      <div className="thread-actions"><strong>{panel.kind === "capture" ? "Capture a window" : panel.name}</strong><button className="icon-button" type="button" aria-label="Close attachment" onClick={() => setPanel(null)}><IconX size={17} /></button></div>
      {panel.kind === "capture" ? <WindowAttachment api={api} windows={windows} busy={adding || loadingWindows} refresh={refreshWindows}
        providers={panel.share ? [[session.provider, session.provider === "codex" ? "Codex" : "Claude Code"]] : undefined} canEdit={canEdit}
        capture={async (id) => { try { return await api[panel.share ? "preview-computer-window" : "preview-window-capture"](id); } catch (reason) { setError(String(reason.message ?? reason)); } }}
        attach={async (token, agent, access) => { setAdding(true); try {
          if (panel.share) setShared(await api["computer-arm"]({ token, agent, access }));
          else add([await api["attach-window-capture"]({ token, existing: record.current.images })]);
          setPanel(null);
        } catch (reason) { setError(String(reason.message ?? reason)); } finally { setAdding(false); } }} />
        : panel.source ? <img src={panel.source} alt={panel.name} /> : <pre>{panel.text}</pre>}
      {error && <p className="live-error" role="alert">{error}</p>}
    </dialog>,
  };
}
