export const efforts = {
  codex: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
  claude: ["low", "medium", "high", "xhigh", "max"],
};
export const reasoningSummaries = ["auto", "concise", "detailed", "none"];
export const effortLabels = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra" };

export function runModelProfile(record) {
  const model = record?.reportedModel || record?.settings?.model;
  const effort = record?.reportedEffort || record?.settings?.effort;
  return model || effort ? { model, effort } : undefined;
}

export function effectiveAgentSettings(defaults, workspace, agent, task = workspace) {
  return task?.agentModels?.[agent] ?? workspace?.models?.[agent] ?? defaults?.[agent] ?? {};
}

export function catalogModel(catalog, model) {
  return catalog?.models.find((item) => item.value === model) ??
    (model ? catalog?.models.find((item) => item.resolvedModel === model) : undefined);
}

const modelId = /^[a-z\d][a-z\d._:/-]{0,159}$/iu;

export function normalizeAgentSettings(agent, options, catalog) {
  const { model = "", effort = "", speed = "", fallbackModel = "", outputStyle = "",
    summary = "", language = "", maxEffort = "" } = options ?? {};
  const capabilities = catalogModel(catalog, model);
  if (typeof model !== "string" || model !== "" && !modelId.test(model) ||
      effort !== "" && !(capabilities?.efforts ?? efforts[agent]).includes(effort) ||
      !["", "standard", "fast"].includes(speed)) throw new Error("Choose a valid model, effort and speed.");
  if (speed === "fast" && !capabilities?.fast) throw new Error("Fast mode is unavailable for this model.");
  if (agent === "codex") {
    if (summary !== "" && !reasoningSummaries.includes(summary)) throw new Error("Choose a valid reasoning summary.");
    return { model, effort, speed, ...(summary && { summary }) };
  }
  if (typeof fallbackModel !== "string" || fallbackModel !== "" && (!modelId.test(fallbackModel) ||
      (catalogModel(catalog, fallbackModel)?.resolvedModel || fallbackModel) === (capabilities?.resolvedModel || model || "default"))) {
    throw new Error("Choose a fallback model different from the primary model.");
  }
  if (typeof outputStyle !== "string" || outputStyle !== "" && (outputStyle.length > 100 ||
      /[\u0000-\u001f]/u.test(outputStyle) || catalog && !catalog.outputStyles?.includes(outputStyle))) {
    throw new Error("Choose a supported output style.");
  }
  if (typeof language !== "string" || language !== "" && !/^[\p{L}\p{M}][\p{L}\p{M} .()'’\u2010-\u2015-]{0,59}$/u.test(language)) {
    throw new Error("Enter a response language name up to 60 characters.");
  }
  if (maxEffort !== "" && !efforts.claude.includes(maxEffort)) throw new Error("Choose a valid Claude effort cap.");
  return { model, effort, speed, fallbackModel, outputStyle, ...(language && { language }), ...(maxEffort && { maxEffort }) };
}

export function codexCatalog(items, config) {
  const models = items.filter((item) => !item.hidden).map((item) => ({
    value: item.model ?? item.id, label: item.displayName, description: item.description,
    efforts: item.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort),
    defaultEffort: item.defaultReasoningEffort,
    fast: item.serviceTiers?.some((tier) => tier.id === "priority") === true,
    isDefault: item.isDefault === true,
  }));
  const defaultModel = models.find((item) => item.value === config?.model) ?? models.find((item) => item.isDefault);
  if (defaultModel) models.unshift({ ...defaultModel, value: "", label: "CLI default · " + defaultModel.label });
  return { models };
}

export function claudeCatalog(response) {
  const fastAvailable = !response.fast_mode_disabled_reason || response.fast_mode_disabled_reason === "sdk_opt_in_required";
  const models = response.models.map((item) => ({
    value: item.value === "default" ? "" : item.value, resolvedModel: item.resolvedModel,
    label: item.displayName, description: item.description,
    efforts: item.supportsEffort === false ? [] : item.supportedEffortLevels ?? (item.supportsEffort ? undefined : []),
    fast: fastAvailable && item.supportsFastMode === true,
  }));
  return { models, outputStyles: response.available_output_styles ?? [] };
}
