import { useMutation } from "@tanstack/react-query";
import { logoutServerFn } from "@/lib/auth.server";

/** Ends the session. Used by the sidebar's Log out and by the account menu on Home. */
export function useLogout() {
  return useMutation({
    mutationFn: () => logoutServerFn(),
    // A full page load, not a client navigation, so nothing the last user saw stays in the browser's memory.
    onSuccess: () => window.location.assign("/sign-in"),
  });
}
