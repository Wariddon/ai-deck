export function codeGraphQuery(value) {
  const symbol = typeof value?.symbol === "string" ? value.symbol.trim().replace(/\(\)$/u, "").trimEnd() : "";
  if (!/^[\p{ID_Start}_$][\p{ID_Continue}$]{0,99}$/u.test(symbol) || !["callers", "impact"].includes(value?.kind)) return;
  const file = typeof value.file === "string" ? value.file.trim().replaceAll("\\", "/") : "";
  if (file && (file.length > 300 || /[:\x00-\x1f]/u.test(file) || file.split("/").some((part) => !part || part === "." || part === ".."))) return;
  return { symbol, kind: value.kind, ...(file && { file }),
    ...(file && Number.isInteger(value.line) && value.line > 0 && { line: value.line }) };
}
