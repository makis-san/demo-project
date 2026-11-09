import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/__index/")({
  loader: () => {
    throw redirect({ to: "/home" });
  },
});
