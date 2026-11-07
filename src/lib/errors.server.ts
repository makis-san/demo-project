import { isNotFound, isRedirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";

/**
 * TanStack Start does not rethrow a ZodError when input validation fails. It
 * throws a plain Error whose message is the JSON list of issues, so the shape
 * of that message is the only thing to go on.
 */
function isValidationError(error: unknown): boolean {
  if (!(error instanceof Error) || !error.message.startsWith("[")) return false;
  try {
    const issues: unknown = JSON.parse(error.message);
    return Array.isArray(issues) && issues.length > 0 && issues.every((i) => i && "code" in i && "path" in i);
  } catch {
    return false;
  }
}

/**
 * Server functions are public endpoints and the router shows error.message in
 * a toast. This stops internal details from reaching the browser:
 * - Redirects and not-found errors pass through, they are meant for the caller.
 * - Invalid input becomes a short "Invalid input" message.
 * - Anything else, such as a database error, is logged here and replaced with a
 *   generic message.
 *
 * next() does not throw when a later middleware or the handler fails. It
 * returns the context with an error field, so that is what gets checked.
 */
export const errorMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const result = await next();
  const error = (result as { error?: unknown }).error;
  if (!error || isRedirect(error) || isNotFound(error)) return result;

  if (isValidationError(error)) throw new Error("Invalid input");

  console.error("Unexpected server function error", error);
  throw new Error("Something went wrong. Please try again.");
});
