const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const maxPatchChars = 64000;
const maxUndoFileBytes = 2 * 1024 ** 2;

function splitFilePatch(file, patch) {
  if (!patch.startsWith("diff --git ") || patch.length > maxPatchChars ||
      /^(?:Binary files .+ differ|GIT binary patch|(?:new |old |deleted file |new file )?mode (?:120000|160000)|index [a-f\d.]+ (?:120000|160000))$/mu.test(patch)) {
    throw new Error("This path does not have a supported text patch: " + file);
  }
  const boundaries = [...patch.matchAll(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@[^\r\n]*/gmu)];
  const header = patch.slice(0, boundaries[0]?.index ?? patch.length);
  const hunks = boundaries.map((entry, index) => ({
    id: index, title: entry[0], text: patch.slice(entry.index, boundaries[index + 1]?.index ?? patch.length),
  }));
  return { file, header, hunks, wholeOnly: !hunks.length || /^(?:new file|deleted file|old|new) mode /mu.test(header) };
}

function composeLinkedPatch(patches, selection) {
  if (!Array.isArray(selection) || !selection.length || selection.length > 12 ||
      new Set(selection.map((item) => item?.file)).size !== selection.length) throw new Error("Choose up to 12 unique files to apply.");
  let text = "";
  for (const { file, hunks } of selection) {
    const patch = patches.get(file);
    if (!patch) throw new Error("Load the current diff before applying " + file + ".");
    if (hunks === null) text += patch.header + patch.hunks.map((hunk) => hunk.text).join("");
    else {
      if (patch.wholeOnly || !Array.isArray(hunks) || !hunks.length ||
          new Set(hunks).size !== hunks.length || hunks.some((id) => !Number.isInteger(id) || id < 0 || id >= patch.hunks.length)) {
        throw new Error("Choose valid hunks from " + file + " or select the whole file.");
      }
      text += patch.header + patch.hunks.filter((hunk) => hunks.includes(hunk.id)).map((hunk) => hunk.text).join("");
    }
    if (text.length > maxPatchChars) throw new Error("The selected patch is too large. Apply fewer files.");
  }
  return text;
}

function undoFile(root, file) {
  let current = root;
  const parts = file.split("/");
  for (const [index, part] of parts.entries()) {
    if (!part || [".", "..", ".git"].includes(part.toLowerCase()) || /[\\:\0]|[. ]$/u.test(part)) return null;
    current = path.join(current, part);
    const info = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!info) return { hash: "absent" };
    if (info.isSymbolicLink() || (index < parts.length - 1 && !info.isDirectory())) return null;
    if (index === parts.length - 1) {
      if (!info.isFile() || info.size > maxUndoFileBytes) return null;
      const bytes = fs.readFileSync(current);
      if (bytes.length > maxUndoFileBytes) return null;
      const text = bytes.toString("utf8");
      return {
        mode: info.mode,
        hash: createHash("sha256").update(String(info.mode)).update("\0").update(bytes).digest("hex"),
        text: Buffer.from(text).equals(bytes) ? "\n" + text.replaceAll("\r\n", "\n") : undefined,
      };
    }
  }
  return null;
}

function postimage(hunk) {
  return hunk.text.split("\n").slice(1).filter((line) => line.startsWith(" ") || line.startsWith("+"))
    .map((line) => line.slice(1).replace(/\r$/u, "")).join("\n");
}

function uniquePostimage(text, hunk) {
  const body = postimage(hunk);
  if (!text || !body) return false;
  // A final line without a newline may be a valid postimage.
  const needle = "\n" + body + "\n";
  const haystack = text.endsWith("\n") ? text : text + "\n";
  const first = haystack.indexOf(needle);
  return first >= 0 && haystack.indexOf(needle, first + 1) < 0;
}

function undoGuards(root, patches) {
  const guards = [];
  for (const patch of patches) {
    const current = undoFile(root, patch.file);
    if (!current) return null;
    guards.push({ file: patch.file, hash: current.hash, mode: current.mode,
      allowNearbyEdits: !patch.wholeOnly && patch.hunks.every((hunk) => uniquePostimage(current.text, hunk)) });
  }
  return guards;
}

function verifyUndoGuards(root, patches, guards) {
  for (const [index, patch] of patches.entries()) {
    const guard = guards[index];
    const current = undoFile(root, patch.file);
    if (!guard || guard.file !== patch.file || !current || current.hash !== guard.hash &&
        (!guard.allowNearbyEdits || current.mode !== guard.mode || !patch.hunks.every((hunk) => uniquePostimage(current.text, hunk)))) {
      throw new Error("Undo stopped because the applied lines or file changed: " + patch.file);
    }
  }
}

function inversePreview(patch) {
  const header = patch.header.split("\n").map((line) => {
    if (line.startsWith("new file mode ")) return line.replace("new file", "deleted file");
    if (line.startsWith("deleted file mode ")) return line.replace("deleted file", "new file");
    if (line.startsWith("old mode ")) return line.replace("old mode", "new mode");
    if (line.startsWith("new mode ")) return line.replace("new mode", "old mode");
    if (line.startsWith("--- ")) return "+++ " + line.slice(4).replace(/^("?)(?:a\/)/u, "$1b/");
    if (line.startsWith("+++ ")) return "--- " + line.slice(4).replace(/^("?)(?:b\/)/u, "$1a/");
    return line.replace(/^(index )([a-f\d]+)\.\.([a-f\d]+)/iu, "$1$3..$2");
  });
  for (const [index, line] of header.entries()) {
    if ((line.startsWith("new mode ") && header[index + 1]?.startsWith("old mode ")) ||
        (line.startsWith("+++ ") && header[index + 1]?.startsWith("--- "))) {
      [header[index], header[index + 1]] = [header[index + 1], line];
    }
  }
  return header.join("\n") + patch.hunks.map(({ text }) => text.replace(/^@@ -([\d,]+) \+([\d,]+) @@/u, "@@ -$2 +$1 @@")
    .replace(/^([+-])/gmu, (prefix) => prefix === "+" ? "-" : "+")).join("");
}

module.exports = { splitFilePatch, composeLinkedPatch, maxPatchChars, undoGuards, verifyUndoGuards, inversePreview };
