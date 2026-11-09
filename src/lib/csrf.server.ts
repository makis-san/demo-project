import { createMiddleware } from "@tanstack/react-start";
import { sessionCookieName } from "./auth.consts";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a request that changes things came from this app's own pages.
 *
 * 1. `Sec-Fetch-Site` is set by the browser and page scripts cannot change it. `same-origin` is our own page and
 *    `none` is the user typing the address. `same-site` is refused on purpose: it is another origin on the same
 *    registrable domain (another port or subdomain), and the session cookie is sent to it, which is the case
 *    `SameSite=Lax` does not cover.
 * 2. Without that header (an old browser, or a tool that is not a browser) `Origin` has to match the `Host` the
 *    request was sent to. Only the host is compared: behind a proxy that ends TLS the app sees `http` while the
 *    browser sent `https`.
 * 3. With neither header the caller is not a browser that follows the Fetch spec. It is allowed only without our
 *    session cookie, so there is no signed-in user whose browser could have been tricked.
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === request.headers.get("host");
    } catch {
      return false; // "null" and anything else that is not a URL
    }
  }

  return !request.headers
    .get("cookie")
    ?.split(";")
    .some((part) => part.trim().startsWith(`${sessionCookieName}=`));
}

/**
 * Refuses requests that change data (every method but GET, HEAD and OPTIONS, so all server function writes) when
 * they did not come from our own pages. This with `SameSite=Lax` is the "Fetch Metadata" defence in the OWASP CSRF
 * cheat sheet. No token is needed, so no form or server function call has to carry one.
 */
export const csrfMiddleware = createMiddleware({ type: "request" }).server(async ({ request, next }) => {
  if (!safeMethods.has(request.method) && !isSameOriginRequest(request)) {
    return new Response("Forbidden", { status: 403 });
  }
  return next();
});
