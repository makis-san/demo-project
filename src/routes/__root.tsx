import { HeadContent, Scripts, createRootRouteWithContext, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import styles from "../styles.css?url";
import { type QueryClient } from "@tanstack/react-query";
import { getUserServerFn } from "@/lib/auth.server";
import { getTimeZoneServerFn } from "@/lib/timezone.server";
import { TimeZoneSync } from "@/components/time-zone-sync";
import { Stage } from "@/components/stage";
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
    <div className="min-h-dvh flex items-center justify-center px-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-danger/15 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-danger" />
          </div>
          <CardTitle className="text-xl">Something went wrong</CardTitle>
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
                className="h-7 w-7 p-0 text-danger hover:bg-danger/15">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
            <AlertDescription className="mt-2">
              {isDev ? (
                <div className="space-y-2">
                  <p className="font-medium text-chalk">{error.name}</p>
                  <p className="text-sm">{error.message}</p>
                  {error.stack && (
                    <details className="mt-2" open>
                      <summary className="cursor-pointer text-sm font-medium">Stack trace</summary>
                      <pre className="mt-2 text-xs overflow-x-auto bg-black/30 p-3 rounded-xl whitespace-pre-wrap break-words max-w-full">
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
              <RefreshCw className="w-4 h-4" />
              Try again
            </Button>
            <Button variant="outline" onClick={() => router.navigate({ to: "/" })} className="w-full">
              <Home className="w-4 h-4" />
              Go to home
            </Button>
          </div>

          {!isDev && (
            <div className="text-center">
              <p className="num text-sm text-faint">Error ID: {Date.now().toString(36)}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  beforeLoad: async () => {
    const [user, timeZone] = await Promise.all([getUserServerFn(), getTimeZoneServerFn()]);
    return { user, timeZone };
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
        name: "theme-color",
        content: "#171412",
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
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap",
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
  const { timeZone } = Route.useRouteContext();
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Stage />
        {children}
        <TimeZoneSync timeZone={timeZone} />
        <ToastContainer position="top-right" autoClose={4000} theme="dark" />
        {config.environment === "development" && (
          <TanStackDevtools
            config={{
              // Not at the bottom: on a phone that corner is the first tab of the navigation bar.
              position: "middle-left",
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
