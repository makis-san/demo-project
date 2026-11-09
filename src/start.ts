import { createStart } from "@tanstack/react-start";
import { csrfMiddleware } from "@/lib/csrf.server";
import { securityHeadersMiddleware } from "@/lib/security-headers.server";

// Request middleware runs for every request, pages and server functions alike. The headers go first, so they are
// also on the response of a request the CSRF check refuses.
export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware, csrfMiddleware],
}));
