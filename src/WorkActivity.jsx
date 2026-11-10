import { useState } from "react";
import { IconArrowRight, IconTerminal2 } from "@tabler/icons-react";
import { commandSummary } from "./command-activity.mjs";

export function OnDemandDetails({ summary, children, className }) {
  const [open, setOpen] = useState(false);
  return <details className={className} onToggle={(event) => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}>
    <summary>{summary}</summary>
    {open && children}
  </details>;
}

export function WorkSteps({ steps, agentLabel }) {
  return <div className="thread-work-steps">{steps.map((step) => {
    const agent = agentLabel?.(step);
    return <OnDemandDetails key={step.id} summary={<>
      {step.handoff ? <IconArrowRight size={14} /> : <IconTerminal2 size={14} />}
      {agent && agent + " · "}{commandSummary(step.command ?? step.text)}
    </>}>
      <pre>{step.text}</pre>
    </OnDemandDetails>;
  })}</div>;
}
