// Streaming CSV (RFC 4180): quoted fields, doubled quotes, commas and line breaks inside quotes,
// CRLF or LF, a leading byte-order mark. Rows come out one at a time, so a 40 MB file never sits
// in memory as a whole.

const START = 0; // at the start of a field
const PLAIN = 1; // inside an unquoted field
const QUOTED = 2; // inside a quoted field
const QUOTE = 3; // read a quote inside a quoted field: the end, or the first half of ""

/** Yields each row as an array of strings. source: an async iterable of strings or Buffers. */
export async function* csvRows(source) {
  const decoder = new TextDecoder("utf-8");
  let state = START;
  let field = "";
  let row = [];
  let first = true;

  for await (const chunk of source) {
    let text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    if (first && text.length) {
      first = false;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    let from = 0; // start of the run of plain characters not yet added to field
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      const newline = c === 10 || c === 13;
      switch (state) {
        case START:
          if (c === 34) {
            state = QUOTED;
            from = i + 1;
          } else if (c === 44) {
            row.push("");
          } else if (newline) {
            if (row.length) {
              row.push("");
              yield row;
              row = [];
            }
          } else {
            state = PLAIN;
            from = i;
          }
          break;
        case PLAIN:
          if (c === 44 || newline) {
            row.push(field + text.slice(from, i));
            field = "";
            state = START;
            if (newline) {
              yield row;
              row = [];
            }
          }
          break;
        case QUOTED:
          if (c === 34) {
            field += text.slice(from, i);
            state = QUOTE;
          }
          break;
        case QUOTE:
          if (c === 34) {
            field += '"';
            state = QUOTED;
            from = i + 1;
          } else if (c === 44 || newline) {
            row.push(field);
            field = "";
            state = START;
            if (newline) {
              yield row;
              row = [];
            }
          } else {
            // Text after a closing quote: keep it, as most readers do.
            state = PLAIN;
            from = i;
          }
          break;
      }
    }
    if (state === PLAIN || state === QUOTED) field += text.slice(from);
  }
  const rest = decoder.decode();
  if (rest) field += rest;
  if (state !== START) {
    row.push(field);
    yield row;
  } else if (row.length) {
    row.push("");
    yield row;
  }
}

/** Yields each row as an object keyed by the header row's names. */
export async function* csvRecords(source) {
  let header = null;
  for await (const row of csvRows(source)) {
    if (!header) {
      header = row.map((name) => name.trim());
      continue;
    }
    const record = {};
    for (let i = 0; i < header.length; i++) record[header[i]] = row[i] ?? "";
    yield record;
  }
}
