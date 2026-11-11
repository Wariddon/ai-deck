const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function startReader() {
  const { createWorker, OEM } = require("tesseract.js");
  const bundled = path.join(__dirname, "ocr-data");
  const launch = (langPath) => createWorker(["tha", "eng"], OEM.LSTM_ONLY, { langPath, cacheMethod: "none", errorHandler: () => {} });
  if ((await fs.stat(bundled).catch(() => null))?.isDirectory()) return launch(bundled);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ai-deck-ocr-data-"));
  const files = [];
  try {
    for (const code of ["tha", "eng"]) {
      const filename = code + ".traineddata.gz";
      const source = path.join(path.dirname(require.resolve("@tesseract.js-data/" + code)), "4.0.0_best_int", filename);
      const destination = path.join(temporary, filename);
      files.push(destination);
      await fs.copyFile(source, destination);
    }
    return await launch(temporary);
  } finally {
    for (const file of files) await fs.rm(file, { force: true });
    await fs.rmdir(temporary);
  }
}

async function openPdfOcr(source) {
  const { getDocument, OPS, AnnotationMode } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const assets = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const assetPath = (folder) => path.join(assets, folder).split(path.sep).join("/") + "/";
  const task = getDocument({
    data: Uint8Array.from(source),
    cMapUrl: assetPath("cmaps"), cMapPacked: true, standardFontDataUrl: assetPath("standard_fonts"),
    wasmUrl: assetPath("wasm"), iccUrl: assetPath("iccs"), useWorkerFetch: false, isEvalSupported: false,
    maxImageSize: 50_000_000, canvasMaxAreaInBytes: 64 * 1024 * 1024,
  });
  let pdf;
  try { pdf = await task.promise; } catch (error) {
    await task.destroy();
    throw error;
  }
  const rasterOperations = new Set([OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObject,
    OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat]);
  let reader;
  let scannedPages = 0;
  return {
    async recognize(pageNumber, progress) {
      const page = await pdf.getPage(pageNumber);
      try {
        const { fnArray } = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
        if (!fnArray.some((op) => rasterOperations.has(op))) return "";
        if (++scannedPages > 50) throw new Error("OCR can read up to 50 scanned pages per PDF. Split the file into smaller parts.");
        progress({ page: pageNumber, total: pdf.numPages });
        const size = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(3.5, 3000 / Math.max(size.width, size.height)) });
        const canvas = pdf.canvasFactory.create(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
        let png;
        try {
          await page.render({ canvasContext: canvas.context, viewport, annotationMode: AnnotationMode.DISABLE, background: "#fff" }).promise;
          png = canvas.canvas.toBuffer("image/png");
        } finally {
          pdf.canvasFactory.destroy(canvas);
        }
        reader ??= await startReader();
        const { data } = await reader.recognize(png, { rotateAuto: true });
        return data.text.trim();
      } finally {
        page.cleanup();
      }
    },
    async close() {
      try { await reader?.terminate(); } finally { await task.destroy(); }
    },
  };
}

module.exports = { openPdfOcr };
