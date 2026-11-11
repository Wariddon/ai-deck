import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconMessagePlus, IconQuote, IconSubtask } from "@tabler/icons-react";
import { maxChatQuote } from "../desktop/chat-quote.mjs";

export function ChatQuoteActions({ taskId, add, sideChat }) {
  const [selection, setSelection] = useState(null);
  const enabled = Boolean(add);
  const allowSideChat = Boolean(sideChat);
  useEffect(() => {
    setSelection(null);
    if (!enabled) return;
    const hide = () => setSelection(null);
    function capture() {
      const picked = window.getSelection();
      const node = picked?.anchorNode;
      const anchor = (node instanceof Element ? node : node?.parentElement)?.closest("[data-chat-quote]");
      if (!anchor || picked.isCollapsed || !anchor.contains(picked.focusNode)) { hide(); return; }
      const text = picked.toString().trim();
      const rect = picked.getRangeAt(0).getClientRects()[0];
      const feed = anchor.closest(".thread-feed")?.getBoundingClientRect();
      const top = Math.max(0, feed?.top ?? 0);
      const bottom = Math.min(innerHeight, feed?.bottom ?? innerHeight);
      if (!text || !rect || rect.bottom < top || rect.top > bottom) { hide(); return; }
      const below = rect.top - top < 42 && bottom - rect.bottom >= 38;
      const inset = allowSideChat ? 142 : 83;
      setSelection({ author: anchor.dataset.chatQuote, text: text.slice(0, maxChatQuote), truncated: text.length > maxChatQuote,
        left: Math.max(inset, Math.min(innerWidth - inset, rect.left + Math.min(rect.width / 2, 140))),
        top: below ? rect.bottom + 5 : rect.top - 5, below });
    }
    function key(event) { if (event.key === "Escape") hide(); else if (event.shiftKey) capture(); }
    function collapse() { if (window.getSelection()?.isCollapsed) hide(); }
    document.addEventListener("pointerup", capture);
    document.addEventListener("keyup", key);
    document.addEventListener("selectionchange", collapse);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerup", capture);
      document.removeEventListener("keyup", key);
      document.removeEventListener("selectionchange", collapse);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [taskId, enabled, allowSideChat]);
  if (!selection || !enabled) return null;
  const root = document.querySelector(".thread-app");
  if (!root) return null;
  function useQuote(action) {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    void action(selection);
  }
  return createPortal(<div className="deck-quote-menu" role="group" aria-label="Selected text actions"
    data-below={selection.below || undefined} style={{ left: selection.left, top: selection.top }}
    onPointerDown={(event) => event.preventDefault()}>
    <IconQuote size={14} aria-hidden="true" />
    <button type="button" className="button small" onClick={() => useQuote(add)}><IconMessagePlus size={14} />Add to chat</button>
    {sideChat && <button type="button" className="button small" onClick={() => useQuote(sideChat)}><IconSubtask size={14} />Ask in side chat</button>}
    {selection.truncated && <small>First 12,000 characters</small>}
  </div>, root);
}

export function ChatTurnRail({ turns, current, jump }) {
  if (turns.length < 2) return null;
  const active = Math.max(0, turns.findIndex(({ id }) => id === current));
  function navigate(event, index) {
    const next = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: turns.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const bounded = Math.max(0, Math.min(turns.length - 1, next));
    jump(turns[bounded].id, false);
    event.currentTarget.parentElement.children[bounded]?.focus({ preventScroll: true });
  }
  return <nav className="deck-chat-rail" aria-label={turns.length + " conversation turns"}>
    <span aria-hidden="true" title={turns.length + " conversation turns"}>{turns.length}</span>
    <div className="deck-chat-markers">
      {turns.map(({ id, prompt }, index) => <button key={id} type="button" tabIndex={index === active ? 0 : -1}
        aria-current={index === active ? "location" : undefined}
        aria-label={"Jump to turn " + (index + 1) + " of " + turns.length}
        title={"Turn " + (index + 1) + " · " + (prompt?.text ?? "Team response").replace(/\s+/gu, " ").slice(0, 92)}
        onClick={() => jump(id)} onKeyDown={(event) => navigate(event, index)} />)}
    </div>
  </nav>;
}
