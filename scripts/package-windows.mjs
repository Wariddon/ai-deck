import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { createWindowsStage } from "./windows-package-stage.mjs";
import { releaseGuide } from "./release-guide.mjs";
import { writeReleaseManifest, archiveHash } from "./release-verification.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "desktop", "package.json"), "utf8"));
const renderer = path.join(root, "dist", "client");
if (process.platform !== "win32" || process.arch !== "x64" || !existsSync(path.join(renderer, "index.html"))) {
  throw new Error("Build AI Deck on Windows x64 before packaging.");
}
const require = createRequire(import.meta.url);
const electron = path.dirname(require("electron"));
if (!existsSync(path.join(electron, "electron.exe"))) throw new Error("The Windows Electron executable is missing.");
const voice = process.env.AI_DECK_VOICE_DIR;
const voiceFiles = ["whisper-cli.exe", "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll", "LICENSE"]
  .map((file) => path.join("whisper", file)).concat(path.join("models", "ggml-base-q5_1.bin"));
if (voice && voiceFiles.some((file) => !existsSync(path.join(voice, file)))) {
  throw new Error("AI_DECK_VOICE_DIR must point to a complete Windows Whisper runtime and model folder.");
}

const { scratch, finish } = createWindowsStage(root, process.argv.includes("--keep-stage"));
const stage = path.join(scratch, "AI Deck");
cpSync(electron, stage, { recursive: true });
renameSync(path.join(stage, "electron.exe"), path.join(stage, "AI Deck.exe"));
const target = path.join(stage, "resources", "app");
const desktop = path.join(root, "desktop");
cpSync(desktop, target, { recursive: true, filter: (source) => source === desktop ||
  (path.dirname(source) === desktop && /^(?:package\.json|notification-icon\.png|[^.][^/\\]*\.(?:cjs|mjs|ps1|ico))$/u.test(path.basename(source))) });
const skill = path.join("skills", "ai-deck-team-review");
cpSync(path.join(desktop, skill), path.join(target, skill), { recursive: true });
const typescript = path.join(target, "node_modules", "typescript");
mkdirSync(path.join(typescript, "lib"), { recursive: true });
for (const file of ["package.json", "LICENSE.txt", "ThirdPartyNoticeText.txt", "lib/typescript.js"]) {
  cpSync(path.join(root, "node_modules", "typescript", file), path.join(typescript, file));
}

// Keep the document reader's Node dependency tree intact for PDF workers and native helpers.
const copiedDocumentPackages = new Set();
function copyDocumentPackage(name, from, optional = false) {
  const source = from.resolve.paths(name)?.map((folder) => path.join(folder, name))
    .find((folder) => existsSync(path.join(folder, "package.json")));
  if (!source && optional) return;
  const relative = source && path.relative(root, source);
  if (!relative?.startsWith("node_modules" + path.sep)) throw new Error("Missing local document dependency: " + name);
  if (copiedDocumentPackages.has(source)) return;
  copiedDocumentPackages.add(source);
  cpSync(source, path.join(target, relative), { recursive: true, filter: (file) =>
    path.basename(file) !== "node_modules" && !path.basename(file).startsWith("officeparser.browser.") });
  const manifest = path.join(source, "package.json");
  const { dependencies, optionalDependencies } = JSON.parse(readFileSync(manifest, "utf8"));
  const local = createRequire(manifest);
  for (const dep of Object.keys({ ...dependencies, ...optionalDependencies })) copyDocumentPackage(dep, local, Boolean(optionalDependencies?.[dep]));
}
copyDocumentPackage("officeparser", require);
const ocrData = path.join(target, "ocr-data");
mkdirSync(ocrData);
for (const code of ["tha", "eng"]) {
  const source = path.dirname(require.resolve("@tesseract.js-data/" + code));
  const filename = code + ".traineddata.gz";
  cpSync(path.join(source, "4.0.0_best_int", filename), path.join(ocrData, filename));
  cpSync(path.join(source, "README.md"), path.join(ocrData, code + "-README.md"));
}

buildSync({
  entryPoints: [path.join(root, "desktop", "native-hooks.cjs")],
  outfile: path.join(target, "native-hooks.cjs"),
  bundle: true,
  platform: "node",
  mainFields: ["module", "main"],
  format: "cjs",
  target: "node22",
});
require(path.join(target, "native-hooks.cjs"));
const hookLicenses = path.join(target, "native-hook-licenses");
mkdirSync(hookLicenses);
for (const [pkg, file] of [["jsonc-parser", "LICENSE.md"], ["toml-eslint-parser", "LICENSE"], ["eslint-visitor-keys", "LICENSE"]]) {
  cpSync(path.join(root, "node_modules", pkg, file), path.join(hookLicenses, pkg + ".txt"));
}
cpSync(renderer, path.join(target, "renderer"), { recursive: true });
const voiceTarget = path.join(target, "voice-tools");
for (const file of voice ? voiceFiles : []) {
  const destination = path.join(voiceTarget, file);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(path.join(voice, file), destination);
}
const htmlPath = path.join(target, "renderer", "index.html");
const csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src blob:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'\">";
writeFileSync(htmlPath, readFileSync(htmlPath, "utf8").replace("<head>", "<head>\n    " + csp));

// Portable packages never inherit this machine's CLI-path overrides or profile.
writeFileSync(path.join(stage, "START HERE.txt"), releaseGuide(version, { voice: Boolean(voice) }));
const release = writeReleaseManifest(target, root);

const archiveName = `AI Deck ${version} Windows x64.zip`;
const archive = path.join(scratch, archiveName);
const archiver = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
execFileSync(archiver, ["-a", "-cf", archiveName, "AI Deck"], { cwd: scratch, windowsHide: true, stdio: "inherit" });
const deliverable = finish(archive);
console.log(JSON.stringify({ executable: path.join(stage, "AI Deck.exe"), archive: deliverable, sha256: await archiveHash(deliverable), ...release }));
