// Weeks for Move: Monday to Sunday, as the WHO weekly guidance is counted here. Plain functions.
import { shiftLocalDate } from "@/lib/meals/time";

/** The Monday of the week a day (YYYY-MM-DD) falls in. */
export const weekStart = (date: string) => {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 Sunday
  return shiftLocalDate(date, -((weekday + 6) % 7));
};

/** The seven days of the week that starts on `monday`. */
export const weekDays = (monday: string) =>
  Array.from({ length: 7 }, (_, i) => shiftLocalDate(monday, i));

const dayMonth = (date: string, withMonth: boolean) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    ...(withMonth ? { month: "long" } : {}),
    timeZone: "UTC",
  });

/** "9 to 15 November", "30 November to 6 December". */
export const weekLabel = (monday: string) => {
  const sunday = shiftLocalDate(monday, 6);
  return monday.slice(0, 7) === sunday.slice(0, 7)
    ? `${dayMonth(monday, false)} to ${dayMonth(sunday, true)}`
    : `${dayMonth(monday, true)} to ${dayMonth(sunday, true)}`;
};
