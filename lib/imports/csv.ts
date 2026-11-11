// CSV for export files read on the device (RFC 4180: quoted fields, doubled quotes, commas and
// line breaks inside quotes, CRLF or LF, a byte-order mark). Semicolon files (some European
// exports) are recognised by their first line. Plain functions.

/** The separator of a CSV text: a semicolon when the first line has more of them than commas. */
export const csvSeparator = (text: string) => {
  const end = text.indexOf("\n");
  const first = end < 0 ? text : text.slice(0, end);
  const count = (c: string) => first.split(c).length - 1;
  return count(";") > count(",") ? ";" : count("\t") > count(",") ? "\t" : ",";
};

/** All rows of a CSV text; empty lines are dropped. */
export const parseCsv = (input: string, separator = csvSeparator(input)): string[][] => {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = separator.charCodeAt(0);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (quoted) {
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += text[i];
      i += 1;
      continue;
    }
    if (c === 34 && field === "") {
      quoted = true;
    } else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === 13 || c === 10) {
      endRow();
      if (c === 13 && text.charCodeAt(i + 1) === 10) i += 1;
    } else {
      field += text[i];
    }
    i += 1;
  }
  if (field !== "" || row.length) endRow();
  return rows;
};

/** Text of a file's bytes: UTF-8, else UTF-16 with a byte-order mark. */
export const decodeText = (bytes: Uint8Array) => {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
};
