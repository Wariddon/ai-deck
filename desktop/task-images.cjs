const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { nativeImage } = require("electron");

const maxImages = 4;
const maxSourceBytes = 12 * 1024 * 1024;
const maxStoredBytes = 2 * 1024 * 1024;
const imageId = /^[a-f0-9-]{36}\.(?:png|jpg)$/u;
const invalidImage = "Choose a valid PNG or JPEG image.";

function dimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.toString("ascii", 12, 16) === "IHDR") {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 3 < bytes.length && bytes[offset++] === 0xff) {
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      }
      offset += length;
    }
  }
  throw new Error(invalidImage);
}

function normalize(source, maxEdge = 1800) {
  if (!(source instanceof Uint8Array) || !source.length || source.length > maxSourceBytes) {
    throw new Error("Image files can be up to 12 MB.");
  }
  const bytes = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  const [width, height] = dimensions(bytes);
  if (!width || !height || width * height > 24_000_000) throw new Error("Images can be up to 24 megapixels.");
  let image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error(invalidImage);
  const size = image.getSize();
  if (Math.max(size.width, size.height) > maxEdge) {
    image = image.resize(size.width >= size.height ? { width: maxEdge, quality: "best" } : { height: maxEdge, quality: "best" });
  }
  const jpeg = bytes[0] === 0xff;
  let extension = jpeg ? "jpg" : "png";
  let data = jpeg ? image.toJPEG(86) : image.toPNG();
  if (data.length > maxStoredBytes) {
    extension = "jpg";
    data = image.toJPEG(80);
  }
  if (!data.length || data.length > maxStoredBytes) throw new Error("This image is too large to attach.");
  return { data, extension };
}

function normalizeName(name) {
  return typeof name === "string" && name.trim() ? path.basename(name).slice(0, 150) : "Pasted image";
}

async function readImageSource(filename) {
  const file = await fs.promises.open(filename, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error(invalidImage);
    if (stat.size > maxSourceBytes) throw new Error("Image files can be up to 12 MB.");
    const buffer = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

async function storeImages(directory, sources) {
  if (!Array.isArray(sources) || !sources.length || sources.length > maxImages) throw new Error("Attach up to four images.");
  const images = [];
  fs.mkdirSync(directory, { recursive: true });
  try {
    for (const source of sources) {
      const { data, extension } = normalize(source.filename ? await readImageSource(source.filename) : source.bytes);
      const id = randomUUID() + "." + extension;
      fs.writeFileSync(path.join(directory, id), data, { flag: "wx" });
      images.push({ id, name: normalizeName(source.name) });
    }
    return images;
  } catch (error) {
    for (const { id } of images) fs.rmSync(path.join(directory, id), { force: true });
    throw error;
  }
}

function storedImagePath(directory, id) {
  if (typeof id !== "string" || !imageId.test(id)) throw new Error("Invalid image attachment.");
  const filename = path.join(directory, id);
  const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (!stat?.isFile() || !stat.size || stat.size > maxStoredBytes) throw new Error("An attached image is missing or invalid. Add it again.");
  return filename;
}

function resolveImages(directory, images = []) {
  if (!Array.isArray(images) || images.length > maxImages) throw new Error("Attach up to four images.");
  const seen = new Set();
  return images.map((image) => {
    const filename = storedImagePath(directory, image?.id);
    if (seen.has(image.id)) throw new Error("An image was attached more than once.");
    seen.add(image.id);
    return { id: image.id, name: normalizeName(image.name), filename };
  });
}

async function previewImageFile(filename, thumbnail) {
  const { data, extension } = normalize(await readImageSource(filename), thumbnail ? 72 : 1800);
  return "data:image/" + (extension === "png" ? "png" : "jpeg") + ";base64," + data.toString("base64");
}

module.exports = { maxImages, maxSourceBytes, storeImages, storedImagePath, resolveImages, previewImageFile };
