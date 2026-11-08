import { getCookie } from "@tanstack/react-start/server";
import { defaultTimeZone, isValidTimeZone, timeZoneCookieName } from "./timezone";

/**
 * The browser's timezone from the request cookie, checked before use because a
 * cookie is user input. Falls back to UTC until the browser has set it.
 *
 * This lives in its own file, not next to getTimeZoneServerFn. The root route
 * imports that file in the browser, and in dev a plain exported helper that
 * uses getCookie would pull the server-only package into the browser bundle.
 */
export function resolveTimeZone(): string {
  const value = getCookie(timeZoneCookieName);
  return value && isValidTimeZone(value) ? value : defaultTimeZone;
}
