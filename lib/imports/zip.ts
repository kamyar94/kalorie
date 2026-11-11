// A small read-only ZIP reader for export files picked on the device (a Samsung Health "Download
// personal data" zip): it reads the central directory from the end of the file and then only the
// entries asked for, so a large export never sits in memory as a whole. Stored and deflated
// entries (DecompressionStream "deflate-raw", in every current browser and in Node), ZIP64 sizes
// and offsets. Works on any Blob (a File from an <input type=file>).

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX = 0xffffffff;

export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
};

const view = async (blob: Blob, start: number, length: number) => {
  const buffer = await blob.slice(start, start + length).arrayBuffer();
  return new DataView(buffer);
};

const u64 = (data: DataView, at: number) => Number(data.getBigUint64(at, true));

/** True when the blob starts like a ZIP file ("PK\x03\x04"). */
export const looksLikeZip = async (blob: Blob) => {
  if (blob.size < 22) return false;
  const head = await view(blob, 0, 4);
  return head.getUint32(0, true) === LOCAL;
};

/** The entries of the central directory. Throws for something that is not a ZIP file. */
export const listZipEntries = async (blob: Blob): Promise<ZipEntry[]> => {
  const tailLength = Math.min(blob.size, 65_557);
  const tailStart = blob.size - tailLength;
  const tail = await view(blob, tailStart, tailLength);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--)
    if (tail.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("This file is not a ZIP file.");
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset === MAX || cdSize === MAX || count === 0xffff) {
    const locator = eocd - 20;
    if (locator < 0 || tail.getUint32(locator, true) !== EOCD64_LOCATOR)
      throw new Error("This ZIP file could not be read.");
    const record = await view(blob, u64(tail, locator + 8), 56);
    if (record.getUint32(0, true) !== EOCD64) throw new Error("This ZIP file could not be read.");
    count = u64(record, 32);
    cdSize = u64(record, 40);
    cdOffset = u64(record, 48);
  }
  const cd = await view(blob, cdOffset, cdSize);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== CENTRAL)
      throw new Error("This ZIP file could not be read.");
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLength = cd.getUint16(p + 28, true);
    const extraLength = cd.getUint16(p + 30, true);
    const commentLength = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = decoder.decode(
      new Uint8Array(
        cd.buffer,
        cd.byteOffset + p + 46,
        Math.min(nameLength, cd.byteLength - p - 46),
      ),
    );
    // ZIP64 extended information: the fields that are 0xFFFFFFFF above, in this order.
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd && e + 4 <= cd.byteLength) {
      const id = cd.getUint16(e, true);
      const length = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === MAX) {
          size = u64(cd, q);
          q += 8;
        }
        if (compressedSize === MAX) {
          compressedSize = u64(cd, q);
          q += 8;
        }
        if (offset === MAX) offset = u64(cd, q);
      }
      e += 4 + length;
    }
    entries.push({ name, method, compressedSize, size, offset });
    p = extraEnd + commentLength;
  }
  return entries;
};

/** The base name of an entry ("jsons/x/com.samsung.y.csv" -> "com.samsung.y.csv"). */
export const baseName = (name: string) => name.slice(name.lastIndexOf("/") + 1);

/** The bytes of one entry, inflated. */
export const readZipEntry = async (blob: Blob, entry: ZipEntry): Promise<Uint8Array> => {
  if (entry.method !== 0 && entry.method !== 8)
    throw new Error(`${baseName(entry.name)} uses a compression Kal cannot read.`);
  const header = await view(blob, entry.offset, 30);
  if (header.getUint32(0, true) !== LOCAL) throw new Error("This ZIP file could not be read.");
  const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const raw = blob.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new Uint8Array(await raw.arrayBuffer());
  const stream = raw.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
