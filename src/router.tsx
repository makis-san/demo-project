import "@/lib/zod-config";
import { createRouter as createTanstackRouter } from "@tanstack/react-router";
import { getGlobalStartContext } from "@tanstack/react-start";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";
import { QueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";

/**
 * The nonce for this response's CSP, made in src/lib/security-headers.server.ts. The browser has no start context and so
 * no nonce. On the server there is none either when the router is only made to resolve a redirect, after the request's
 * own context has ended (a protected server function called without a session), and that router renders nothing.
 */
function requestNonce(): string | undefined {
  try {
    return (getGlobalStartContext() as { nonce?: string } | undefined)?.nonce;
  } catch {
    return undefined;
  }
}

// Create a new router instance
export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        onError: (error) => {
          toast.error(`${error.message}`);
        },
      },
    },
  });

  const router = createTanstackRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    // The router puts the nonce on its inline scripts and in a meta tag, which the browser side reads.
    ssr: { nonce: requestNonce() },
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
};

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
