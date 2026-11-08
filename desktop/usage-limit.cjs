function resetTime(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const milliseconds = value < 1e12 ? value * 1000 : value;
  return milliseconds <= 8.64e15 ? milliseconds : null;
}

function observed(kind, resetAt = null) {
  return { kind, resetAt, observedAt: Date.now() };
}

function textLimit(text) {
  if (typeof text !== "string") return null;
  if (/\b(?:credit balance is too low|out of (?:extra usage|usage credits)|insufficient (?:api |usage )?credits)\b/iu.test(text)) return observed("credits");
  if (/\b(?:you(?:'ve|’ve| have)? (?:hit|reached|exceeded) (?:your |the )?(?:(?:session |weekly |daily )?usage|session|weekly|daily) limit|usage limit (?:has been )?(?:reached|exceeded))\b/iu.test(text)) {
    return observed("usage");
  }
  return null;
}

function codexLimit(error, rateLimits) {
  const info = error?.codexErrorInfo;
  const code = typeof info === "string" ? info : Object.keys(info ?? {}).find((key) => key.toLowerCase() === "usagelimitexceeded");
  const typed = code?.toLowerCase() === "usagelimitexceeded";
  const text = textLimit(error?.message);
  if (!typed && !text) return null;
  const reached = rateLimits?.rateLimitReachedType ?? "";
  if (text?.kind === "credits" || reached.includes("credits_depleted")) return observed("credits");
  const explicit = resetTime(error?.resetsAt ?? error?.resetAt ?? error?.resets_at);
  const resets = [rateLimits?.primary, rateLimits?.secondary]
    .filter((window) => window?.usedPercent >= 100)
    .map((window) => resetTime(window.resetsAt))
    .filter((value) => value && value > Date.now());
  return observed("usage", explicit ?? (resets.length ? Math.max(...resets) : null));
}

function claudeLimitEvent(info) {
  if (info?.status !== "rejected") return null;
  return info.errorCode === "credits_required" ? observed("credits") : observed("usage", resetTime(info.resetsAt));
}

function codexWindows(report) {
  const buckets = Object.entries(report?.rateLimitsByLimitId ?? {});
  if (!buckets.length && report?.rateLimits) buckets.push([report.rateLimits.limitId ?? "codex", report.rateLimits]);
  return buckets.flatMap(([id, bucket]) => ["primary", "secondary"].flatMap((kind) => {
    const window = bucket?.[kind];
    if (!window) return [];
    return [{ id: id + ":" + kind, name: bucket.limitName ?? id, usedPercent: window.usedPercent,
      windowDurationMins: window.windowDurationMins, resetAt: resetTime(window.resetsAt), observedAt: Date.now() }];
  }));
}

function claudeQuota(info) {
  if (!["allowed", "allowed_warning", "rejected"].includes(info?.status)) return null;
  const id = typeof info.rateLimitType === "string" ? info.rateLimitType.slice(0, 60) : "reported";
  const ratio = info.utilization;
  return {
    id, name: id === "reported" ? "Reported limit" : id.replaceAll("_", " "), status: info.status,
    usedPercent: Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio * 100 : null,
    resetAt: resetTime(info.resetsAt), observedAt: Date.now(),
  };
}

function codexResetOffer(report, now = Date.now()) {
  const summary = report?.rateLimitResetCredits;
  if (!Number.isSafeInteger(summary?.availableCount) || summary.availableCount < 0) return null;
  const eligible = (summary.credits ?? []).filter((credit) => credit.status === "available" && typeof credit.id === "string" &&
    (credit.expiresAt == null || resetTime(credit.expiresAt) > now));
  const [credit] = eligible.sort((a, b) => (resetTime(a.expiresAt) ?? Infinity) - (resetTime(b.expiresAt) ?? Infinity));
  return { count: summary.availableCount, creditId: credit?.id, expiresAt: resetTime(credit?.expiresAt) };
}

function codexAccountUsage(report) {
  const bucket = report?.rateLimitsByLimitId?.codex ?? report?.rateLimits;
  const credits = bucket?.credits;
  return {
    windows: codexWindows(report),
    plan: bucket?.planType ?? null,
    credits: credits ? { balance: credits.balance ?? null, hasCredits: credits.hasCredits, unlimited: credits.unlimited } : null,
    fetchedAt: Date.now(),
  };
}

function claudeAccountUsage(report) {
  const rate = report?.rate_limits;
  const fetchedAt = Date.now();
  const windows = Array.isArray(rate?.limits) ? rate.limits.map((row, index) => {
    const labels = { session: "Current session", weekly_all: "Weekly · all models", weekly_scoped: "Weekly" };
    return {
      id: row.kind + ":" + index,
      name: [labels[row.kind] ?? row.kind.replaceAll("_", " "), row.scope?.model?.display_name, row.scope?.surface?.display_name].filter(Boolean).join(" · "),
      usedPercent: row.percent,
      resetAt: resetTime(Date.parse(row.resets_at)),
      observedAt: fetchedAt,
    };
  }) : null;
  const extra = rate?.extra_usage;
  return { windows, fetchedAt, credits: extra ? {
    enabled: extra.is_enabled, usedMinor: extra.used_credits, capMinor: extra.monthly_limit, currency: extra.currency,
  } : null };
}

module.exports = { codexLimit, claudeLimitEvent, claudeQuota, codexWindows, textLimit, codexResetOffer, codexAccountUsage, claudeAccountUsage };
