import crypto from "node:crypto";
import { createMiddleware } from "@tanstack/react-start";
import { configService } from "./config.server";

/**
 * The Content-Security-Policy for one response. `nonce` is new for every response and is also put on the router's own
 * inline scripts, so those run and an inline script someone manages to inject does not.
 *
 * - `script-src` has no `unsafe-inline`: only our own files and scripts that carry the nonce run. This is the part of
 *   a CSP that stops cross-site scripting.
 * - `style-src` keeps `unsafe-inline`. Three things write styles at run time and none of them can take a nonce: React's
 *   `style="..."` attributes (the dials and charts), react-toastify and torph (each adds a `<style>` element from
 *   JavaScript), and the Vite dev server. Styles cannot run code, so this costs far less than it would for scripts. A
 *   hash per library would break the look of the page silently on every upgrade.
 * - Google Fonts: its stylesheet comes from `fonts.googleapis.com` and the font files from `fonts.gstatic.com`.
 * - `frame-ancestors 'none'` stops other sites from putting the app in a frame (clickjacking).
 * - `form-action 'self'` and `base-uri 'self'` close two ways to send data away without a script.
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Puts the security headers on every response, pages and server functions alike, and hands the nonce to the router
 * through the request context (see src/router.tsx). It is the first request middleware, so the 403 from the CSRF
 * check gets the headers too.
 */
export const securityHeadersMiddleware = createMiddleware({ type: "request" }).server(async ({ next }) => {
  const development = configService.getAppConfig().environment === "development";
  const nonce = crypto.randomBytes(16).toString("base64");

  const { response, ...rest } = await next({ context: { nonce } });

  response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // The same as frame-ancestors for browsers that do not know that directive.
  response.headers.set("X-Frame-Options", "DENY");
  // Not in development: a browser would then insist on HTTPS for localhost for a year.
  if (!development) response.headers.set("Strict-Transport-Security", "max-age=31536000");

  return { response, ...rest };
});
