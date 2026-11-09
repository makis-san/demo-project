import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { sessionsQueryOptions } from "./-queries/account";
import { SessionsCard } from "./-sessions-card";

export const Route = createFileRoute("/__index/_layout/account/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(sessionsQueryOptions());
  },
  component: AccountPage,
});

function AccountPage() {
  const { timeZone } = Route.useRouteContext();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="You" title="Account" />
      <SessionsCard timeZone={timeZone} />
    </div>
  );
}
