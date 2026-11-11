import { ControlPopover } from "./ControlPopover.jsx";
import { Brand } from "./TeamThread.jsx";

function Direction({ value }) {
  const first = value === "claude" ? "claude" : "codex";
  const second = first === "codex" ? "claude" : "codex";
  return <span className="deck-direction-label"><Brand agent={first} size={13} />{first === "codex" ? "Codex" : "Claude"}
    <span aria-hidden="true">{value === "discuss" ? "↔" : "→"}</span><Brand agent={second} size={13} />{second === "codex" ? "Codex" : "Claude"}</span>;
}

export function TeamDirectionPicker({ value, order, disabled, choose }) {
  return <ControlPopover className="deck-team-direction" title="Change team direction" disabled={disabled}
    label={<Direction value={value === "custom" ? order : value} />}>
    <div className="deck-control-label">For the next message</div>
    {value === "custom" && <small className="setting-detail">เลือกคนทำงานและคนตรวจด้านล่าง หรือปรับบทบาทอื่นใน Session Team</small>}
    {[
      ["codex", "Codex ทำงาน แล้ว Claude ตรวจ"],
      ["claude", "Claude ทำงาน แล้ว Codex ตรวจ"],
      ["discuss", "คุยโต้ตอบ ไม่แก้ไฟล์ ใช้รอบสนทนาจำกัด"],
    ].map(([key, text]) => <button className="deck-direction-option" type="button" key={key} aria-pressed={value === key}
      disabled={disabled} onClick={() => choose(key)}><Direction value={key} /><small>{text}</small></button>)}
    <small className="setting-detail">Saved in this session. Model choices stay with each provider.</small>
  </ControlPopover>;
}
