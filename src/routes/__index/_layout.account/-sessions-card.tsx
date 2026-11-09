import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Laptop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { revokeOtherSessionsServerFn, revokeSessionServerFn } from "@/lib/sessions.server";
import { sessionsQueryOptions } from "./-queries/account";

const dateAndTime: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

/** Every browser the user is signed in on, with a button to sign one out or all the others. */
export function SessionsCard({ timeZone }: { timeZone: string }) {
  const queryClient = useQueryClient();
  const { data: sessions } = useSuspenseQuery(sessionsQueryOptions());
  const others = sessions.filter((session) => !session.isCurrent);

  // Also after a refusal ("already signed out"), so the list shows what the server has.
  const refresh = () => queryClient.invalidateQueries({ queryKey: sessionsQueryOptions().queryKey });

  const revokeOne = useMutation({
    mutationFn: async (sessionId: string) => {
      const result = await revokeSessionServerFn({ data: { sessionId } });
      if (!result.success) throw new Error(result.error);
    },
    onSettled: refresh,
  });
  const revokeOthers = useMutation({
    mutationFn: () => revokeOtherSessionsServerFn(),
    onSettled: refresh,
  });

  return (
    <Card className="enter enter-1 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3 px-2 pt-2 pb-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">
            Where you are signed in
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={others.length === 0 || revokeOthers.isPending}
          onClick={() => revokeOthers.mutate()}>
          Sign out all other devices
        </Button>
      </div>

      <ul aria-label="Signed-in devices" className="space-y-2">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center gap-3 rounded-2xl bg-well px-4 py-3">
            <Laptop aria-hidden="true" className="h-5 w-5 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-chalk">
                <span>{session.deviceLabel}</span>
                {session.isCurrent && (
                  <span className="eyebrow rounded-full bg-primary/15 px-2 py-0.5 text-accent">This device</span>
                )}
              </p>
              <p className="num text-xs text-faint">
                Signed in {formatDate(session.createdAt, timeZone, dateAndTime)}
                {!session.isCurrent && <> · Last active {formatDate(session.lastSeenAt, timeZone, dateAndTime)}</>}
              </p>
            </div>
            {!session.isCurrent && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Sign out ${session.deviceLabel}`}
                disabled={revokeOne.isPending}
                onClick={() => revokeOne.mutate(session.id)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="px-2 pt-4 text-xs text-faint">
        Last active is saved at most once an hour. A device that is not used for 7 days is signed out, and every device
        is signed out 30 days after it signed in.
      </p>
    </Card>
  );
}
