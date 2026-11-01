// A small read-only ZIP reader for the FoodData Central releases: lists the central directory
// and streams one entry at a time (stored or deflated, ZIP64 sizes and offsets understood).
// Nothing is extracted to disk. Node's zlib does the inflating, so no extra dependency.
import { open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import zlib from "node:zlib";

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX = 0xffffffff;

const readAt = async (handle, position, length) => {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
};

/** Reads the central directory of a ZIP file: [{ name, method, compressedSize, size, offset }]. */
export const listZip = async (file) => {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, 65_557);
    const tail = await readAt(handle, size - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === EOCD) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw new Error(`${file} is not a ZIP file.`);
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === MAX || cdSize === MAX || count === 0xffff) {
      const locator = eocd - 20;
      if (locator < 0 || tail.readUInt32LE(locator) !== EOCD64_LOCATOR)
        throw new Error(`${file}: ZIP64 directory locator missing.`);
      const record = await readAt(handle, Number(tail.readBigUInt64LE(locator + 8)), 56);
      if (record.readUInt32LE(0) !== EOCD64) throw new Error(`${file}: bad ZIP64 directory.`);
      count = Number(record.readBigUInt64LE(32));
      cdSize = Number(record.readBigUInt64LE(40));
      cdOffset = Number(record.readBigUInt64LE(48));
    }
    const cd = await readAt(handle, cdOffset, cdSize);
    const entries = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== CENTRAL) throw new Error(`${file}: bad central directory.`);
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let uncompressed = cd.readUInt32LE(p + 24);
      const nameLength = cd.readUInt16LE(p + 28);
      const extraLength = cd.readUInt16LE(p + 30);
      const commentLength = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLength);
      // ZIP64 extended information: the fields that are 0xFFFFFFFF above, in this order.
      let e = p + 46 + nameLength;
      const extraEnd = e + extraLength;
      while (e + 4 <= extraEnd) {
        const id = cd.readUInt16LE(e);
        const length = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncompressed === MAX) {
            uncompressed = Number(cd.readBigUInt64LE(q));
            q += 8;
          }
          if (compressedSize === MAX) {
            compressedSize = Number(cd.readBigUInt64LE(q));
            q += 8;
          }
          if (offset === MAX) offset = Number(cd.readBigUInt64LE(q));
        }
        e += 4 + length;
      }
      entries.push({ name, method, compressedSize, size: uncompressed, offset });
      p = extraEnd + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
};

/** A readable stream of one entry's bytes. */
export const openZipEntry = async (file, entry) => {
  if (entry.method !== 0 && entry.method !== 8)
    throw new Error(`${entry.name}: unsupported compression method ${entry.method}.`);
  const handle = await open(file, "r");
  let header;
  try {
    header = await readAt(handle, entry.offset, 30);
  } finally {
    await handle.close();
  }
  if (header.readUInt32LE(0) !== LOCAL) throw new Error(`${entry.name}: bad local header.`);
  const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (entry.compressedSize === 0) return Readable.from([]);
  const raw = createReadStream(file, { start, end: start + entry.compressedSize - 1 });
  if (entry.method === 0) return raw;
  const inflate = zlib.createInflateRaw();
  raw.on("error", (error) => inflate.destroy(error));
  return raw.pipe(inflate);
};

/** Finds an entry by its file name, ignoring the folder it sits in. */
export const findEntry = (entries, baseName) =>
  entries.find((entry) => entry.name === baseName || entry.name.endsWith(`/${baseName}`)) ?? null;
