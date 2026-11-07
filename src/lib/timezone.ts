export const timeZoneCookieName = "tz";

export const defaultTimeZone = "UTC";

/** True when Intl knows the name, for example "America/Recife". */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The timezone the browser is in. Client only. */
export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
