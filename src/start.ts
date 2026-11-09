import { createStart } from "@tanstack/react-start";
import { csrfMiddleware } from "@/lib/csrf.server";

// Request middleware runs for every request, pages and server functions alike.
export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
}));
