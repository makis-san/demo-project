import { z } from "zod";

// Zod checks whether it may build validators with `new Function`. A CSP without 'unsafe-eval' blocks that. Zod then
// falls back to the plain path and nothing breaks, but the browser reports a violation on every page load. Turning the
// fast path off in the browser skips the check. The server keeps it, since the CSP is about the browser.
// This has to be imported before any module that builds a schema.
if (typeof window !== "undefined") z.config({ jitless: true });
