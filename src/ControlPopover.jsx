import { useId, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";

export function ControlPopover({ label, title, icon, className, beforeOpen, onOpen, lazy = false, disabled = false, closeOnButton = true, children }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="button small deck-controls-trigger" disabled={disabled} aria-label={title} title={title} popoverTarget={id}
      onPointerDown={beforeOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") beforeOpen?.(); }}>
      {icon}<span>{label}</span><IconChevronDown size={13} aria-hidden="true" />
    </button>
    <div id={id} popover="auto" role="group" aria-label={title} className={"deck-controls-panel " + className}
      onToggle={lazy || onOpen ? (event) => {
        if (event.target !== event.currentTarget) return;
        if (lazy) setOpen(event.newState === "open");
        if (event.newState === "open") onOpen?.();
      } : undefined}
      onClick={(event) => {
        if (closeOnButton && event.target.closest("button") && event.currentTarget.matches(":popover-open")) event.currentTarget.hidePopover();
      }}>
      {(!lazy || open) && children}
    </div>
  </>;
}
