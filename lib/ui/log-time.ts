// The moment a one-tap log from a day's screen is recorded at (a favorite logged again, a
// medicine's "Log now"): now when the screen shows today, else 12:00 of the day shown, as the
// water card does. Plain functions, safe for client and server.
import { fromLocalInputValue } from "./format";

/** Noon: the time a one-tap log lands at on an earlier day. */
export const EARLIER_DAY_TIME = "12:00";

/** ISO time for a one-tap log on `date` (YYYY-MM-DD) while `today` is today in `tz`. */
export const oneTapTime = (date: string, today: string, tz: string, now = new Date()) =>
  date === today
    ? now.toISOString()
    : (fromLocalInputValue(`${date}T${EARLIER_DAY_TIME}`, tz) ?? now.toISOString());
