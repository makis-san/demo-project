/** What a user sees when something failed that is not theirs to know about. The server and the pages share it. */
export const fallbackErrorMessage = "Something went wrong. Please try again.";

/**
 * The text to show for a failed server function call. `errorMiddleware` makes sure the server only throws
 * messages that are safe to show, so the message is used as it is. When the request never got an answer,
 * for example because the network is down, the browser's own text ("Failed to fetch") is a TypeError and
 * not a message for the user, so the same generic text as the server's is shown instead.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message && !(error instanceof TypeError)) return error.message;
  return fallbackErrorMessage;
}
