import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { getBrowserTimeZone, timeZoneCookieName } from "@/lib/timezone";

/**
 * Saves the browser's timezone in a cookie so the server can render dates in
 * it. The first request has no cookie, so that page is rendered in UTC. When
 * the browser's timezone is different, this saves it and reloads the route
 * data so dates switch to the right day.
 */
export function TimeZoneSync({ timeZone }: { timeZone: string }) {
  const router = useRouter();

  useEffect(() => {
    const browserTimeZone = getBrowserTimeZone();
    if (browserTimeZone === timeZone) return;
    document.cookie = `${timeZoneCookieName}=${encodeURIComponent(browserTimeZone)}; path=/; max-age=31536000; samesite=lax`;
    router.invalidate();
  }, [timeZone, router]);

  return null;
}
