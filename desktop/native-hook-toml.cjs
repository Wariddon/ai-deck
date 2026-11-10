const { getStaticTOMLValue, parseTOML } = require("toml-eslint-parser");
const { isDeepStrictEqual } = require("node:util");

const parseHookToml = (text) => getStaticTOMLValue(parseTOML(text));
const keys = (node) => node.key.keys.map((key) => key.name ?? key.value);
const quote = (value) => JSON.stringify(value).replace(/\u007f/gu, "\\u007F");

function valueText(value) {
  if (typeof value === "string") return quote(value);
  if (typeof value === "boolean" || Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return "[" + value.map(valueText).join(", ") + "]";
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return "{ " + Object.entries(value).map(([key, child]) => quote(key) + " = " + valueText(child)).join(", ") + " }";
  }
  throw new Error("This hook contains a TOML value the editor cannot preserve.");
}

function editHookToml(raw, event, groups) {
  const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = raw.slice(bom.length);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const ast = parseTOML(text);
  const original = getStaticTOMLValue(ast);
  const before = ast.body[0].body;
  const eventGroups = valueText(groups);
  const edits = [];
  function replace(node, replacement) {
    edits.push({ start: node.range[0], end: node.range[1], replacement });
  }
  const inline = before.find((node) => node.type === "TOMLKeyValue" && isDeepStrictEqual(keys(node), ["hooks"]));
  if (inline) {
    const field = inline.value.body?.find((node) => isDeepStrictEqual(keys(node), [event]));
    if (field) replace(field.value, eventGroups);
    else {
      const end = inline.value.range[1] - 1;
      const separator = inline.value.body?.length ? ", " : "";
      edits.push({ start: end, end, replacement: separator + quote(event) + " = " + eventGroups + " " });
    }
  } else {
    const hookTable = before.find((node) => node.type === "TOMLTable" && isDeepStrictEqual(node.resolvedKey, ["hooks"]));
    const assignment = hookTable?.body.find((node) => isDeepStrictEqual(keys(node), [event]))
      ?? before.find((node) => node.type === "TOMLKeyValue" && isDeepStrictEqual(keys(node), ["hooks", event]));
    if (assignment) replace(assignment.value, eventGroups);
    else {
      const tables = before.filter((node) => node.type === "TOMLTable" && node.resolvedKey[0] === "hooks" && node.resolvedKey[1] === event);
      const blocks = groups.map((group) => [
        "[[hooks." + quote(event) + "]]",
        ...Object.entries(group).map(([key, value]) => quote(key) + " = " + valueText(value)),
      ].join(eol)).join(eol + eol);
      if (tables.length) tables.forEach((table, index) => replace(table, index === 0 ? blocks : ""));
      else edits.push({ start: text.length, end: text.length, replacement: (text ? eol + eol : "") + blocks + eol });
    }
  }
  let updated = text;
  for (const { start, end, replacement } of edits.sort((a, b) => b.start - a.start)) {
    updated = updated.slice(0, start) + replacement + updated.slice(end);
  }
  const expected = { ...original, hooks: { ...original.hooks, [event]: groups } };
  try {
    if (isDeepStrictEqual(parseHookToml(updated), expected)) return bom + updated;
  } catch {}
  throw new Error("AI Deck could not update just this event. The original TOML file is unchanged.");
}

module.exports = { parseHookToml, editHookToml };
