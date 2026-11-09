import { useEffect, useState } from "react";

/**
 * The current time, updated every `intervalMs` while `active`. Null on the server and in the first render, so a
 * clock never renders one time on the server and another in the browser.
 */
export function useNow(intervalMs = 1000, active = true) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

/** 75 seconds as "1:15", an hour and more as "1:02:05". */
export function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** A short buzz on phones that support it. Does nothing elsewhere, or when the user asked for reduced motion. */
export function buzz(pattern: number | number[]) {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers refuse without a recent tap. A missing buzz is fine.
  }
}

/** localStorage that never throws: private windows and blocked storage just remember nothing. */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      // Nothing to do: the value just isn't remembered.
    }
  },
};
