import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, following the window as it changes. On the server it is `fallback`, so only use it
 * for what is not on the screen at first (a form that opens after a tap), or the browser's first render disagrees
 * with the server's HTML. Use CSS for anything the server renders.
 */
export function useMediaQuery(query: string, fallback = false) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}

/** Below Tailwind's `md`: the phone layout. */
export const useIsPhone = () => !useMediaQuery("(min-width: 48rem)", false);
