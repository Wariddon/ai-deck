export function nativeChatEvent(state, event) {
  const controls = state.controls ?? [];
  if (event.type === "approval" || event.type === "question") return { ...state,
    controls: [...controls.filter(({ key }) => key !== event.key), event].slice(-16) };
  if (["control-resolved", "approval-cancelled", "finished"].includes(event.type)) return { ...state,
    controls: controls.map((row) => event.type === "finished" || row.key === event.key
      ? { ...row, decision: event.decision ?? (event.type === "finished" ? "Turn ended" : "Cancelled") } : row) };
  if (event.type === "activity") {
    const steps = state.steps ?? [];
    const item = { key: event.key ?? "step:" + steps.length, text: String(event.text ?? "Working").slice(0, 12000) };
    return { ...state, steps: [...steps.filter(({ key }) => key !== item.key), item].slice(-80) };
  }
  if (event.type === "stopping") return { ...state, stopping: true };
  return state;
}
