/**
 * Formats a date in a fixed timezone and locale. The server and the browser
 * both pass the same timezone, so both produce the same text and React does
 * not report a hydration mismatch.
 */
export function formatDate(
  value: Date | string | number,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Date(value).toLocaleDateString("en-US", { ...options, timeZone });
}

export const fullDate: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
};

export const shortDate: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

export const chartDate: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
