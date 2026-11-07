import { HeadContent, Scripts, createRootRouteWithContext, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import styles from "../styles.css?url";
import { type QueryClient } from "@tanstack/react-query";
import { getUserServerFn } from "@/lib/auth.server";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { useClientConfig } from "@/lib/config.client";
import { AlertTriangle, RefreshCw, Home, Bug, Copy, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ToastContainer } from "react-toastify";
import toastifyStyles from "react-toastify/dist/ReactToastify.css?url";

interface MyRouterContext {
  queryClient: QueryClient;
}

function RootErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const clientConfig = useClientConfig();
  const isDev = clientConfig.environment === "development";
  const [copied, setCopied] = useState(false);

  const copyErrorToClipboard = async () => {
    const errorInfo = `Error Name: ${error.name}
Error Message: ${error.message}
Timestamp: ${new Date().toISOString()}
User Agent: ${navigator.userAgent}
URL: ${window.location.href}

Stack Trace:
${error.stack || "No stack trace available"}`;

    try {
      await navigator.clipboard.writeText(errorInfo);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy error to clipboard:", err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-red-600" />
          </div>
          <CardTitle className="text-xl font-semibold text-gray-900">Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <Bug className="h-4 w-4" />
            <div className="flex items-start justify-between">
              <AlertTitle>Error Details</AlertTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyErrorToClipboard}
                className="h-6 px-2 text-red-700 hover:bg-red-100">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
            <AlertDescription className="mt-2">
              {isDev ? (
                <div className="space-y-2">
                  <p className="font-medium">{error.name}</p>
                  <p className="text-sm">{error.message}</p>
                  {error.stack && (
                    <details className="mt-2" open>
                      <summary className="cursor-pointer text-sm font-medium">Stack trace</summary>
                      <pre className="mt-2 text-xs overflow-x-auto bg-red-100 p-2 rounded whitespace-pre-wrap break-words max-w-full">
                        {error.stack}
                      </pre>
                    </details>
                  )}
                </div>
              ) : (
                <p>
                  We encountered an unexpected error. Please try refreshing the page or contact support if the problem
                  persists.
                </p>
              )}
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-2">
            <Button onClick={reset} className="w-full">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try again
            </Button>
            <Button variant="outline" onClick={() => router.navigate({ to: "/" })} className="w-full">
              <Home className="w-4 h-4 mr-2" />
              Go to home
            </Button>
          </div>

          {!isDev && (
            <div className="text-center">
              <p className="text-sm text-gray-500">Error ID: {Date.now().toString(36)}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  beforeLoad: async () => {
    const user = await getUserServerFn();
    return { user };
  },
  errorComponent: RootErrorComponent,
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Setlist",
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      {
        rel: "stylesheet",
        href: styles,
      },
      {
        rel: "stylesheet",
        href: toastifyStyles,
      },
    ],
  }),

  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  const config = useClientConfig();
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="overflow-hidden">
        {children}
        <ToastContainer position="top-right" autoClose={4000} theme="light" />
        {config.environment === "development" && (
          <TanStackDevtools
            config={{
              position: "bottom-left",
            }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
              {
                name: "TanStack Query",
                render: <ReactQueryDevtoolsPanel />,
              },
            ]}
          />
        )}
        <Scripts />
      </body>
    </html>
  );
}
