/**
 * Date helpers pinned to the business timezone (IST by default).
 *
 * All "calendar day" logic (today, yesterday, presets, report windows) must go
 * through these helpers so that the server (UTC on Vercel) and the browser
 * agree on which day it is. Day strings are always "YYYY-MM-DD".
 */

export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Kolkata";

/** Offset used to convert an IST calendar day into a UTC instant range. */
const APP_UTC_OFFSET = process.env.NEXT_PUBLIC_APP_UTC_OFFSET || "+05:30";

/** Calendar day ("YYYY-MM-DD") of the given instant in the app timezone. */
export function dayInAppTz(d: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function todayInAppTz(): string {
  return dayInAppTz(new Date());
}

/** Pure calendar arithmetic on "YYYY-MM-DD" strings (timezone independent). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Inclusive number of days between two "YYYY-MM-DD" strings. */
export function daysBetweenInclusive(start: string, end: string): number {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

/** First and last day of the calendar month before the month containing `day`. */
export function previousMonthRange(day: string): { start: string; end: string } {
  const [y, m] = day.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}

/** UTC ISO instants for the start of `startDay` and the start of the day after `endDay`, in the app timezone. */
export function dayRangeToInstants(startDay: string, endDay: string): { from: string; toExclusive: string } {
  return {
    from: new Date(`${startDay}T00:00:00${APP_UTC_OFFSET}`).toISOString(),
    toExclusive: new Date(`${addDays(endDay, 1)}T00:00:00${APP_UTC_OFFSET}`).toISOString(),
  };
}

/** Monday..Sunday of the most recently completed week, in the app timezone. */
export function lastCompletedWeek(): { weekStart: string; weekEnd: string } {
  const today = todayInAppTz();
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  const thisMonday = addDays(today, -((dow + 6) % 7));
  const weekStart = addDays(thisMonday, -7);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}
