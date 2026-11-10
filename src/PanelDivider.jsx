import { useRef, useState } from "react";
import { defaultPanelWidths } from "../desktop/panel-layout.mjs";

const names = { projects: "Projects", inspector: "Inspector" };
const keys = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

export function PanelDivider({ side, panel, layoutRef, save }) {
  const pointer = useRef(null);
  const pending = useRef(null);
  const [preview, setPreview] = useState(null);
  const direction = side === "projects" ? 1 : -1;
  const { min, max, width } = panel;
  const variable = "--" + side + "-width";

  function previewWidth(value) {
    const next = Math.max(min, Math.min(max, Math.round(value)));
    pending.current = next;
    layoutRef.current.style.setProperty(variable, next + "px");
    setPreview(next);
  }

  function finish(keep) {
    const next = pending.current;
    pending.current = null;
    pointer.current = null;
    setPreview(null);
    if (keep && next !== null && next !== width) save(side, next);
    else layoutRef.current.style.setProperty(variable, width + "px");
  }

  return <div className="thread-divider" role="separator" aria-label={"Resize " + names[side]} aria-orientation="vertical"
    aria-controls={side === "projects" ? "deck-project-sidebar" : "thread-inspector"} aria-valuemin={min} aria-valuemax={max}
    aria-valuenow={preview ?? width} aria-valuetext={(preview ?? width) + " pixels"} tabIndex={0}
    title={"Drag to resize " + names[side] + ". Use arrow keys or double-click to reset."}
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      pointer.current = { id: event.pointerId, x: event.clientX, width };
    }}
    onPointerMove={(event) => {
      const start = pointer.current;
      if (start?.id === event.pointerId) previewWidth(start.width + (event.clientX - start.x) * direction);
    }}
    onPointerUp={(event) => { if (pointer.current?.id === event.pointerId) finish(true); }}
    onLostPointerCapture={(event) => { if (pointer.current?.id === event.pointerId) finish(false); }}
    onDoubleClick={() => save(side, defaultPanelWidths[side])}
    onKeyDown={(event) => {
      if (event.key === "Escape" && pending.current !== null) {
        event.preventDefault();
        finish(false);
      }
      if (!keys.has(event.key) || pointer.current) return;
      event.preventDefault();
      if (event.key === "Home") previewWidth(min);
      else if (event.key === "End") previewWidth(max);
      else previewWidth((pending.current ?? width) + (event.key === "ArrowLeft" ? -16 : 16) * direction);
    }}
    onKeyUp={(event) => { if (keys.has(event.key) && !pointer.current && pending.current !== null) finish(true); }}
    onBlur={() => { if (!pointer.current && pending.current !== null) finish(true); }} />;
}