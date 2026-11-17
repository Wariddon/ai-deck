import { memo, useEffect, useRef, useState } from 'react';
import { ChatMarkdown } from './ChatMarkdown.jsx';

// One observer per transcript. Revealed messages stay mounted so their Copy/
// wrap controls retain state; offscreen text remains searchable and selectable.
export function markdownViewport(root) {
  let observer;
  const pending = new Map();
  return {
    watch(element, reveal) {
      observer ??= new IntersectionObserver((entries, owner) => {
        for (const entry of entries) if (entry.isIntersecting) {
          const reveal = pending.get(entry.target);
          pending.delete(entry.target); owner.unobserve(entry.target); reveal?.();
        }
      }, { root: root.current, rootMargin: '1200px 0px' });
      pending.set(element, reveal); observer.observe(element);
      return () => { pending.delete(element); observer?.unobserve(element); };
    },
    dispose() { observer?.disconnect(); pending.clear(); observer = null; },
  };
}

export const DeferredChatMarkdown = memo(function DeferredChatMarkdown({ text, defer, viewport }) {
  const element = useRef(null);
  const [revealed, reveal] = useState(!defer || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!defer) { reveal(true); return; }
    if (!revealed) return viewport.watch(element.current, () => reveal(true));
  }, [defer, revealed, viewport]);
  return <div ref={element} data-native-deferred={defer && !revealed ? '' : undefined}>
    {!defer || revealed ? <ChatMarkdown text={text} /> : <div className="deck-native-plain">{text}</div>}
  </div>;
});
