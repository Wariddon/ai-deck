const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { attachmentInput, resolveAttachments, storeAttachments } = require("../desktop/task-images.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deck-attachments-"));
  t.after(() => {
    for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file));
    fs.rmdirSync(directory);
  });
  return directory;
}

test("multiple UTF-8 files round-trip as quoted attachments with their original names", async (t) => {
  const directory = fixture(t);
  const sources = Array.from({ length: 8 }, (_, index) => ({ name: "รายงาน-" + index + ".log", bytes: Buffer.from("line " + index) }));
  const saved = await storeAttachments(directory, sources);
  const attachments = resolveAttachments(directory, saved);
  assert.equal(attachments.length, 8);
  assert.ok(attachments.every(({ kind }) => kind === "text"));
  const input = attachmentInput("Summarize.", attachments);
  assert.equal(input.split("\n")[0], "Summarize.");
  assert.deepEqual(JSON.parse(input.split("\n").at(-1)),
    sources.map(({ name, bytes }) => ({ name, text: bytes.toString() })));
  assert.throws(() => resolveAttachments(directory, [saved[0], saved[0]]), /more than once/u);
});

test("failed batches keep existing attachments and roll back new files", async (t) => {
  const directory = fixture(t);
  const [original] = await storeAttachments(directory, [{ name: "keep.txt", bytes: Buffer.alloc(128 * 1024, 97) }]);
  const next = { name: "next.txt", bytes: Buffer.from("short") };
  await assert.rejects(storeAttachments(directory, [next, { name: "big.txt", bytes: Buffer.alloc(140 * 1024, 97) }], [original]), /256 KB/u);
  await assert.rejects(storeAttachments(directory, [next, { name: "binary.dat", bytes: Buffer.from([0xff, 0]) }], [original]), /UTF-8/u);
  assert.deepEqual(fs.readdirSync(directory), [original.id]);
});

test("chat quote metadata survives attachment resolution without marking ordinary text files", async (t) => {
  const directory = fixture(t);
  const [file, quote] = await storeAttachments(directory, [
    { name: "Quote from Claude Code.txt", bytes: Buffer.from("Ordinary pasted file") },
    { name: "Quote from Claude Code.txt", bytes: Buffer.from("Selected passage") },
  ]);
  const resolved = resolveAttachments(directory, [file, { ...quote, chatQuote: true }]);
  assert.equal(resolved[0].chatQuote, undefined);
  assert.equal(resolved[1].chatQuote, true);
  assert.equal(fs.readFileSync(resolved[1].filename, "utf8"), "Selected passage");
});

test("Word and Excel attachments store previewable text with tables and worksheet names", async (t) => {
  const directory = fixture(t);
  const { parseOffice } = require("officeparser");
  const source = await parseOffice(Buffer.from("# Ledger\n\n| Item | Count |\n| --- | --- |\n| Orchard | 17 |"), { fileType: "md" });
  const { value: docx } = await source.to("docx");
  const { value: xlsx } = await source.to("xlsx");
  const saved = await storeAttachments(directory, [{ name: "Notes.docx", bytes: docx }, { name: "Report.xlsx", bytes: xlsx }]);
  const [word, excel] = JSON.parse(attachmentInput("Check", resolveAttachments(directory, saved)).split("\n").at(-1));
  assert.equal(word.name, "Notes.docx");
  assert.match(word.text, /Orchard \| 17/u);
  assert.equal(excel.name, "Report.xlsx");
  assert.match(excel.text, /Sheet Ledger[\s\S]+Orchard \| 17/u);
});

function pdfFixture(content, image) {
  const entries = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >>" +
      (image ? " /XObject << /Scan 6 0 R >>" : "") + " >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream",
  ];
  if (image) entries.push(Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>\nstream\n`),
    image.jpeg, Buffer.from("\nendstream"),
  ]));
  const pdf = [Buffer.from("%PDF-1.4\n")];
  let length = pdf[0].length;
  const offsets = entries.map((entry, index) => {
    const offset = length;
    const object = Buffer.concat([Buffer.from((index + 1) + " 0 obj\n"), Buffer.from(entry), Buffer.from("\nendobj\n")]);
    pdf.push(object);
    length += object.length;
    return String(offset).padStart(10, "0") + " 00000 n \n";
  });
  const count = entries.length + 1;
  return Buffer.concat([...pdf, Buffer.from(`xref\n0 ${count}\n0000000000 65535 f \n` + offsets.join("") +
    `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`)]);
}

test("PDF attachments preserve page labels and reject pages with no text layer", async (t) => {
  const directory = fixture(t);
  const [saved] = await storeAttachments(directory, [{ name: "Report.pdf", bytes: pdfFixture("BT /F1 12 Tf 20 200 Td (Parcel 42) Tj ET") }]);
  const [attachment] = resolveAttachments(directory, [saved]);
  assert.match(fs.readFileSync(attachment.filename, "utf8"), /Page 1\s+Parcel 42/u);
  await assert.rejects(storeAttachments(directory, [{ name: "Blank.pdf", bytes: pdfFixture("") }]), /No readable text/u);
});

test("a PDF image is read locally even if the page already has a short text footer", async (t) => {
  const directory = fixture(t);
  const pdfRequire = createRequire(require.resolve("pdfjs-dist/package.json"));
  const { createCanvas } = pdfRequire("@napi-rs/canvas");
  const canvas = createCanvas(1000, 260);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = "bold 66px sans-serif";
  context.fillStyle = "#000";
  context.fillText("FALCON 7964", 80, 148);
  const bytes = pdfFixture("q 260 0 0 68 20 165 cm /Scan Do Q BT /F1 10 Tf 20 24 Td (Page 1) Tj ET",
    { jpeg: canvas.toBuffer("image/jpeg"), width: canvas.width, height: canvas.height });
  const events = [];
  const [saved] = await storeAttachments(directory, [{ name: "Scan.pdf", bytes }], undefined,
    (event) => events.push(event));
  const [attachment] = resolveAttachments(directory, [saved]);
  assert.match(fs.readFileSync(attachment.filename, "utf8"), /Page 1 \(OCR · Thai\/English\)[\s\S]+FALCON 7964/u);
  assert.deepEqual(events, [{ name: "Scan.pdf", page: 1, total: 1 }]);
});
