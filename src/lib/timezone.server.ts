import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { defaultTimeZone, isValidTimeZone, timeZoneCookieName } from "./timezone";

/**
 * The browser's timezone as saved in a cookie. The cookie comes from the
 * request, so it is checked before use. Without a valid one, UTC is used until
 * the browser sets the cookie.
 */
export const getTimeZoneServerFn = createServerFn().handler(async () => {
  const value = getCookie(timeZoneCookieName);
  return value && isValidTimeZone(value) ? value : defaultTimeZone;
});
