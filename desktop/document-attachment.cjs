const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const documentSourceBytes = 20 * 1024 * 1024;
const textBudget = 256 * 1024;
const textBudgetError = "This message can hold up to 256 KB of attached text, including extracted document content. Split the file or send a second message.";
const documentType = (name) => /\.(pdf|docx|xlsx)$/iu.exec(name)?.[1].toLowerCase();

async function extract({ source, format, remaining }) {
  const { parseOffice, generate } = require("officeparser");
  const ast = await parseOffice(Buffer.from(source.buffer, source.byteOffset, source.byteLength), {
    fileType: format,
    extractAttachments: false,
    ocr: false,
    decompressionLimits: {
      maxUncompressedBytes: 64 * 1024 * 1024, maxZipEntries: 4096,
      maxTableCells: 100_000, maxXmlElements: 250_000, maxRepeatedContent: 4 * 1024 * 1024,
    },
    ...(format === "pdf" && { pdfParserConfig: { separateProcess: false } }),
  });
  if (ast.warnings.some(({ code }) => code.endsWith("LIMIT_EXCEEDED"))) {
    throw new Error("The document is too complex to extract in full. Attach a smaller section.");
  }
  const markdown = async (content) => (await generate({ ...ast, metadata: {}, content }, "md")).value;
  const clean = (text) => text.trim().replace(/^(?:---\s*)+/u, "").trim();
  const textLength = (text) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const sections = [];
  let hasText = false;
  const add = (label, body) => {
    hasText ||= Boolean(body);
    const content = label ? label + "\n\n" + (body || "[No extractable text]") : body;
    remaining -= Buffer.byteLength(content) + 2;
    if (remaining < 0) throw new Error(textBudgetError);
    sections.push(content);
  };
  let ocr;
  try {
    if (format === "docx") {
      add("", clean(await markdown(ast.content)));
    } else {
      for (const [index, section] of ast.content.entries()) {
        const page = section.metadata?.pageNumber ?? index + 1;
        let label = format === "pdf" ? "Page " + page : "Sheet " + (section.metadata?.sheetName ?? index + 1);
        let text = clean(await markdown([section]));
        if (format === "pdf" && textLength(text) < 24) {
          ocr ??= await require("./pdf-ocr.cjs").openPdfOcr(source);
          const recognized = await ocr.recognize(page, (progress) => parentPort.postMessage({ progress }));
          if (textLength(recognized) > textLength(text)) {
            text = recognized;
            label += " (OCR · Thai/English)";
          }
        }
        add(label, text);
      }
    }
  } finally { await ocr?.close(); }
  if (!hasText) {
    throw new Error(format === "pdf" ? "No readable text was found in this PDF. Try a sharper scan or a searchable PDF."
      : "The document has no readable text or cells.");
  }
  return sections.join("\n\n");
}

function extractDocument(source, format, remaining, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { source, format, remaining },
      resourceLimits: { maxOldGenerationSizeMb: 192 }, stdout: true, stderr: true });
    worker.stdout.resume();
    worker.stderr.resume();
    let finished = false;
    const finish = (error, text) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      void worker.terminate();
      if (error) reject(new Error(error));
      else resolve(text);
    };
    const timedOut = () => finish("Reading the document took too long. Attach a smaller section.");
    let timeout = setTimeout(timedOut, 25000);
    let readingScan = false;
    worker.on("message", ({ error, text, progress }) => {
      if (finished) return;
      if (!progress) { finish(error, text); return; }
      if (!readingScan) {
        readingScan = true;
        clearTimeout(timeout);
        timeout = setTimeout(timedOut, 180000);
      }
      onProgress?.(progress);
    });
    worker.once("error", () => finish("Couldn't extract this document. Try a smaller file or attach it as text."));
    worker.once("exit", () => finish("The document reader stopped. Try a smaller file."));
  });
}

if (!isMainThread) {
  void extract(workerData).then((text) => parentPort.postMessage({ text }), (error) => {
    const code = error?.officeIssue?.code;
    const message = code?.startsWith("PASSWORD_") ? "Unlock the document before attaching it."
      : code?.endsWith("LIMIT_EXCEEDED") ? "The document is too complex to extract in full. Attach a smaller section."
      : code ? "Couldn't read this document. Check its format and try saving a new copy." : error?.message ?? "Couldn't read this document.";
    parentPort.postMessage({ error: message });
  });
}

module.exports = { documentSourceBytes, documentType, extractDocument, textBudget, textBudgetError };
