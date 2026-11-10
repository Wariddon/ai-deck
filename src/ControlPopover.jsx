import { useId, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";

export function ControlPopover({ label, title, icon, className, beforeOpen, lazy = false, children }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="button small deck-controls-trigger" aria-label={title} title={title} popoverTarget={id}
      onPointerDown={beforeOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") beforeOpen?.(); }}>
      {icon}<span>{label}</span><IconChevronDown size={13} aria-hidden="true" />
    </button>
    <div id={id} popover="auto" role="group" aria-label={title} className={"deck-controls-panel " + className}
      onToggle={lazy ? (event) => { if (event.target === event.currentTarget) setOpen(event.newState === "open"); } : undefined}
      onClick={(event) => {
        if (event.target.closest("button") && event.currentTarget.matches(":popover-open")) event.currentTarget.hidePopover();
      }}>
      {(!lazy || open) && children}
    </div>
  </>;
}
