// Dates and times as export files write them: ISO ("2024-05-01 07:30:00.000", with or without a
// zone), year first with slashes or dots, day or month first ("14/11/2023, 7:59:12 AM"), and
// epoch milliseconds or seconds. A time without a zone is a wall-clock time in the person's time
// zone. Plain functions.
import { isLocalDate, localParts } from "@/lib/meals/time";
import { fromLocalInputValue } from "@/lib/ui/format";

export type DateOrder = "ymd" | "dmy" | "mdy";

export type Moment = { at: Date; date: string };

const YEAR_FIRST =
  /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*([AP]\.?M\.?)?)?\s*(Z|UTC|GMT|(?:UTC|GMT)?[+-]\d{2}:?\d{2})?$/i;
const SHORT_FIRST =
  /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*([AP]\.?M\.?)?)?$/i;

const pad = (n: number) => String(n).padStart(2, "0");

const hour24 = (hour: number, meridiem: string | undefined) => {
  if (!meridiem) return hour;
  const pm = /^p/i.test(meridiem);
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
};

/** "+02:00" from "UTC+0200", "+02:00", "Z". */
const offsetOf = (zone: string) => {
  if (/^(z|utc|gmt)$/i.test(zone)) return "Z";
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(zone);
  return m ? `${m[1]}${m[2]}:${m[3]}` : null;
};

const wallMoment = (date: string, time: string, tz: string): Moment | null => {
  if (!isLocalDate(date)) return null;
  const iso = fromLocalInputValue(`${date}T${time}`, tz);
  return iso ? { at: new Date(iso), date } : null;
};

/**
 * A moment from a cell, or null. Wall-clock times are read in `tz`; a date alone is noon of that
 * day. `order` decides "03/04/2024" (day first, month first); year-first dates need none.
 */
export const parseMoment = (raw: string, order: DateOrder, tz: string): Moment | null => {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (/^\d{9,13}$/.test(text)) {
    const value = Number(text);
    const at = new Date(text.length >= 12 ? value : value * 1000);
    return Number.isNaN(at.getTime()) ? null : { at, date: localParts(at, tz).date };
  }
  let y: number, mo: number, d: number;
  let hh = 12;
  let mi = 0;
  let zone: string | undefined;
  const first = YEAR_FIRST.exec(text);
  const short = first ? null : SHORT_FIRST.exec(text);
  if (first) {
    y = Number(first[1]);
    mo = Number(first[2]);
    d = Number(first[3]);
    if (first[4] !== undefined) {
      hh = hour24(Number(first[4]), first[7]);
      mi = Number(first[5]);
    }
    zone = first[8];
  } else if (short) {
    const a = Number(short[1]);
    const b = Number(short[2]);
    const year = short[3] ?? "";
    y = Number(year.length === 2 ? `20${year}` : year);
    [d, mo] = order === "mdy" ? [b, a] : [a, b];
    if (short[4] !== undefined) {
      hh = hour24(Number(short[4]), short[7]);
      mi = Number(short[5]);
    }
  } else {
    // Anything else Date understands with a zone in it ("2024-05-01T07:30:00+02:00" variants).
    if (!/(z|[+-]\d{2}:?\d{2})$/i.test(text)) return null;
    const at = new Date(text);
    return Number.isNaN(at.getTime()) ? null : { at, date: localParts(at, tz).date };
  }
  if (hh > 23 || mi > 59) return null;
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  const time = `${pad(hh)}:${pad(mi)}`;
  if (!isLocalDate(date)) return null;
  if (zone) {
    const offset = offsetOf(zone);
    if (!offset) return null;
    const at = new Date(`${date}T${time}:00${offset}`);
    return Number.isNaN(at.getTime()) ? null : { at, date: localParts(at, tz).date };
  }
  return wallMoment(date, time, tz);
};

/**
 * Whether short dates in a column are day first or month first: a first number above 12 means
 * day first, a second one above 12 month first; undecided columns use `fallback`.
 */
export const guessDateOrder = (values: string[], fallback: DateOrder = "mdy"): DateOrder => {
  let dayFirst = false;
  let monthFirst = false;
  for (const value of values) {
    const m = SHORT_FIRST.exec(value.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return "dmy";
  if (monthFirst && !dayFirst) return "mdy";
  return values.some((v) => YEAR_FIRST.test(v.trim())) ? "ymd" : fallback;
};

/** A number from a cell: "1,234.5", "1234,5" (decimal comma), "--" and "" are null. */
export const parseNumber = (raw: string | undefined) => {
  if (raw === undefined) return null;
  let text = raw.trim().replace(/\s+/g, "");
  if (!text || /^[-–—]+$/.test(text)) return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, "");
  else if (/^-?\d+,\d+$/.test(text)) text = text.replace(",", ".");
  const value = Number(text.replace(/[^\d.eE+-]/g, ""));
  return /\d/.test(text) && Number.isFinite(value) ? value : null;
};
