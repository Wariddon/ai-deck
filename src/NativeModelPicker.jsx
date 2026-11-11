import { useEffect, useRef, useState } from "react";
import { IconAdjustments, IconRefresh } from "@tabler/icons-react";
import { catalogModel, effortLabels, efforts } from "../desktop/agent-settings.mjs";
import { ControlPopover } from "./ControlPopover.jsx";

const empty = { model: "", effort: "", speed: "" };

export function NativeModelPicker({ provider, chat, busy, api, save, onSaving }) {
  const [options, setOptions] = useState(() => ({ ...empty, ...chat?.modelSettings }));
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const request = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setOptions({ ...empty, ...chat?.modelSettings }); }, [chat?.modelStamp]);

  const current = chat?.modelSettings ?? empty;
  const label = [catalogModel(catalog, current.model)?.label ?? (current.model || "Model"),
    current.effort ? effortLabels[current.effort] ?? current.effort : "Effort",
    current.speed ? current.speed === "fast" ? "Fast" : "Standard" : "Speed"].join(" · ");
  const capability = catalogModel(catalog, options.model);
  const levels = capability?.efforts ?? efforts[provider];
  const missingModel = Boolean(options.model && catalog && !capability);
  const invalidEffort = Boolean(options.effort && !levels.includes(options.effort));
  const unavailable = busy || !chat?.available || chat.active || chat.unverified;

  async function load(refresh = false) {
    if (request.current) return request.current;
    setLoading(true); setError("");
    const promise = api["provider-models"]({ agent: provider, refresh }).then((result) => {
      if (mounted.current) setCatalog(result);
    }).catch((reason) => {
      if (mounted.current) setError(String(reason.message ?? reason));
    }).finally(() => {
      request.current = null;
      if (mounted.current) setLoading(false);
    });
    request.current = promise;
    return promise;
  }

  function changeModel(model) {
    const next = catalogModel(catalog, model);
    setOptions((value) => ({ ...value, model,
      effort: (next?.efforts ?? efforts[provider]).includes(value.effort) ? value.effort : "",
      speed: value.speed === "fast" && (!model || !next?.fast) ? "standard" : value.speed,
    }));
    setSaved(false);
  }

  async function apply(event) {
    const panel = event.currentTarget.closest("[popover]");
    setSaving(true); setError(""); setSaved(false);
    onSaving?.(true);
    try {
      const result = await save(options);
      if (result && mounted.current) { setSaved(true); panel?.hidePopover(); }
    } catch (reason) {
      if (mounted.current) setError(String(reason.message ?? reason));
    } finally { if (mounted.current) { setSaving(false); onSaving?.(false); } }
  }

  return <ControlPopover label={label} title={(provider === "codex" ? "Codex" : "Claude Code") + " model, effort and speed"}
    icon={<IconAdjustments size={14} />} className="deck-native-model-panel" disabled={unavailable}
    onOpen={() => { setSaved(false); void load(); }} closeOnButton={false}>
    <div className="thread-actions deck-native-model-heading"><strong>Model settings</strong>
      <button type="button" className="icon-button" aria-label="Refresh available models" title="Refresh available models"
        disabled={loading || saving} onClick={() => load(true)}><IconRefresh size={14} /></button>
    </div>
    <p className="setting-detail">Saved for this chat. Applies to your next message.</p>
    {loading && <p className="setting-detail" role="status">Reading available models…</p>}
    <label className="field"><strong>Model</strong><select aria-label="Original chat model" value={options.model}
      disabled={loading || saving || unavailable} onChange={(event) => changeModel(event.target.value)}>
      <option value="">Follow original chat</option>
      {options.model && !catalog?.models.some(({ value }) => value === options.model) &&
        <option value={options.model} disabled={Boolean(catalog)}>{options.model}{catalog ? " (unavailable)" : ""}</option>}
      {catalog?.models.filter(({ value }) => value).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <div className="deck-form-grid">
      <label className="field"><strong>Effort</strong><select aria-label="Original chat effort" value={options.effort}
        disabled={loading || saving || unavailable || !levels.length && !invalidEffort}
        onChange={(event) => { setOptions({ ...options, effort: event.target.value }); setSaved(false); }}>
        <option value="">{levels.length ? "Follow original chat" : "Managed by model"}</option>
        {levels.map((level) => <option value={level} key={level}>{effortLabels[level] ?? level}</option>)}
        {invalidEffort && <option value={options.effort} disabled>{options.effort} (unavailable)</option>}
      </select></label>
      <label className="field"><strong>Speed</strong><select aria-label="Original chat speed" value={options.speed}
        disabled={loading || saving || unavailable} onChange={(event) => { setOptions({ ...options, speed: event.target.value }); setSaved(false); }}>
        <option value="">Follow original chat</option><option value="standard">Standard</option>
        <option value="fast" disabled={!options.model || !capability?.fast}>Fast{!options.model || !capability?.fast ? " (unavailable)" : ""}</option>
      </select></label>
    </div>
    {!capability?.fast && <p className="setting-detail">Fast is available only when the CLI reports support for the selected model and account.</p>}
    {error && <p className="live-error" role="alert">{error}</p>}
    {saved && <p className="setting-detail" role="status">Saved.</p>}
    <div className="thread-actions deck-native-model-actions">
      <button type="button" className="button small" disabled={saving || unavailable} onClick={() => { setOptions({ ...empty }); setSaved(false); }}>Use chat defaults</button>
      <button type="button" className="button primary small" disabled={saving || loading || unavailable || missingModel || invalidEffort ||
        options.speed === "fast" && (!options.model || !capability?.fast)} onClick={apply}>{saving ? "Saving…" : "Save"}</button>
    </div>
  </ControlPopover>;
}
