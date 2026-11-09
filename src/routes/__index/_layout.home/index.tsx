import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ChevronRight, History, Play, Repeat2, Scale } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AccountMenu } from "@/components/account-menu";
import { getCurrentWorkoutServerFn } from "@/lib/workouts.server";
import { formatDate } from "@/lib/dates";
import { formatClock, useNow } from "@/lib/use-now";
import { elapsedMs, isPaused } from "@/lib/workout-timeline";
import { weekdayNames } from "@/components/workout-card";
import { weightUnit } from "@/lib/units";
import { cn } from "@/lib/utils";
import { currentWorkoutQueryOptions } from "../_layout.current-workout/-queries/current-workout";
import { latestBodyWeightQueryOptions } from "../_layout.body-weight/-queries/body-weight";
import {
  lastWorkoutQueryOptions,
  trainingCalendarQueryOptions,
} from "../_layout.workout-history/-queries/workout-history";
import { todayQueryOptions } from "../_layout.workout-library/-queries/presets";

export const Route = createFileRoute("/__index/_layout/home/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(currentWorkoutQueryOptions()),
      context.queryClient.ensureQueryData(todayQueryOptions(context.timeZone)),
      context.queryClient.ensureQueryData(trainingCalendarQueryOptions(context.timeZone)),
      context.queryClient.ensureQueryData(latestBodyWeightQueryOptions()),
      context.queryClient.ensureQueryData(lastWorkoutQueryOptions()),
    ]);
  },
  component: HomePage,
});

const dayMs = 24 * 60 * 60 * 1000;
const volumeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const weekLetters = ["M", "T", "W", "T", "F", "S", "S"];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Bench Press, Back Squat +2": the first few names and how many more there are. */
function brief(names: string[], max = 3) {
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}

function greeting(timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(Date.now()),
  );
  return hour < 5 ? "Hey" : hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
}

/**
 * The first screen is today: the date and a greeting, then the one thing to do (resume the workout in progress, start
 * the workout planned for today, or start any), this week as seven days, and the last session and body weight in a line each.
 */
function HomePage() {
  const { timeZone, user } = Route.useRouteContext();
  const { data: workout } = useSuspenseQuery(currentWorkoutQueryOptions());
  const { data: today } = useSuspenseQuery(todayQueryOptions(timeZone));
  const { data: calendar } = useSuspenseQuery(trainingCalendarQueryOptions(timeZone));
  const { data: bodyWeight } = useSuspenseQuery(latestBodyWeightQueryOptions());
  const { data: last } = useSuspenseQuery(lastWorkoutQueryOptions());

  const firstName = user.name?.trim().split(/\s+/)[0];

  // This week, Monday to Sunday. Days are plain dates in the user's timezone, so the math is on UTC midnights.
  const todayTime = Date.parse(`${calendar.today}T00:00:00Z`);
  const monday = todayTime - ((new Date(todayTime).getUTCDay() + 6) % 7) * dayMs;
  const byDay = new Map(calendar.days.map((d) => [d.day, d]));
  const days = Array.from({ length: 7 }, (_, i) => {
    const time = monday + i * dayMs;
    return {
      time,
      entry: byDay.get(new Date(time).toISOString().slice(0, 10)),
      isToday: time === todayTime,
      future: time > todayTime,
    };
  });
  const week = days.reduce(
    (sum, d) => ({
      workouts: sum.workouts + (d.entry?.workouts ?? 0),
      sets: sum.sets + (d.entry?.sets ?? 0),
      volume: sum.volume + (d.entry?.volume ?? 0),
    }),
    { workouts: 0, sets: 0, volume: 0 },
  );

  return (
    <div className="space-y-7 md:max-w-3xl">
      <header className="enter relative z-20 flex items-start justify-between gap-4 pt-1">
        <h1 className="sr-only">Home</h1>
        <div className="min-w-0">
          <p className="num text-sm text-muted">
            {formatDate(`${calendar.today}T12:00:00Z`, "UTC", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          {firstName && (
            <p
              className="mt-1 text-3xl leading-[1.1] font-bold tracking-[-0.02em] font-stretch-[112%] text-chalk sm:text-[2.75rem]"
              suppressHydrationWarning>
              {greeting(timeZone)}, {firstName}
            </p>
          )}
        </div>
        <AccountMenu name={user.name ?? null} email={user.email} />
      </header>

      {workout ? (
        <Resume workout={workout} />
      ) : today.workouts.length > 0 ? (
        <section className="enter enter-1" aria-label="Workout of the day">
          <Card className="p-2 sm:p-3">
            <ul className="divide-y divide-line">
              {today.workouts.map((w) => (
                <li key={w.id} data-workout={w.name} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold tracking-tight text-chalk font-stretch-[108%]">
                      {w.name}
                    </p>
                    <p className="truncate text-sm text-muted">
                      {brief(w.movements.map((m) => m.name)) || "No movements yet"}
                    </p>
                    {w.doneToday && <p className="mt-1 text-xs font-semibold text-ok">Done today</p>}
                  </div>
                  <Link
                    to="/start-workout"
                    search={{ preset: w.id, from: undefined }}
                    aria-label={`Start ${w.name}`}
                    className={buttonClasses({ variant: w.doneToday ? "outline" : "default", size: "lg" })}>
                    <Play className="h-4 w-4 fill-current" />
                    {w.doneToday ? "Again" : "Start"}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : (
        <section className="enter enter-1 space-y-3" aria-label="Start">
          <Link
            to="/start-workout"
            search={{ preset: undefined, from: undefined }}
            className={buttonClasses({ size: "lg", className: "h-16 w-full text-lg" })}>
            <Play className="h-5 w-5 fill-current" />
            Start a workout
          </Link>
          {last && last.setCount > 0 && (
            <Link
              to="/start-workout"
              search={{ preset: undefined, from: last.id }}
              className="press flex h-11 items-center justify-center gap-2 rounded-full border border-line-strong bg-white/[0.04] px-4 text-sm font-medium text-chalk hover:bg-white/[0.09]">
              <Repeat2 className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <span className="truncate">
                Repeat last:{" "}
                {last.presetName ?? formatDate(last.completedAt, timeZone, { month: "short", day: "numeric" })}
              </span>
            </Link>
          )}
        </section>
      )}

      <section className="enter enter-2 space-y-3" aria-label="This week">
        <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">This week</h2>
        <ol className="grid grid-cols-7 gap-1.5">
          {days.map(({ time, entry, isToday, future }, i) => (
            <li
              key={time}
              data-trained={!!entry}
              aria-label={`${weekdayNames[i]}${entry ? `, ${plural(entry.workouts, "workout")}` : ""}${isToday ? ", today" : ""}`}
              className="flex flex-col items-center gap-1.5">
              <span aria-hidden="true" className={cn("text-xs", isToday ? "font-semibold text-chalk" : "text-faint")}>
                {weekLetters[i]}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "num grid aspect-square w-full max-w-11 place-items-center rounded-full text-sm font-semibold",
                  entry
                    ? "bg-primary text-primary-ink shadow-[0_6px_16px_-6px_var(--color-primary)]"
                    : future
                      ? "border border-dashed border-line text-faint/60"
                      : "bg-well text-faint",
                  isToday && "ring-2 ring-chalk/70 ring-offset-2 ring-offset-ground",
                )}>
                {new Date(time).getUTCDate()}
              </span>
            </li>
          ))}
        </ol>
        <p className="num text-sm text-muted">
          {week.workouts === 0
            ? "No workouts yet this week"
            : week.sets === 0
              ? `${plural(week.workouts, "workout")} · no sets logged`
              : `${plural(week.workouts, "workout")} · ${plural(week.sets, "set")} · ${volumeFormat.format(week.volume)} ${weightUnit}`}
        </p>
      </section>

      <Card className="enter enter-3 divide-y divide-line px-4">
        {last && (
          <Link to="/workout-history" className="flex min-h-14 items-center gap-3 py-3">
            <History className="h-[18px] w-[18px] shrink-0 text-faint" aria-hidden="true" />
            <span className="sr-only">Last session</span>
            <span className="num min-w-0 flex-1 truncate text-sm text-chalk">
              {[
                formatDate(last.completedAt, timeZone, { month: "short", day: "numeric" }),
                last.setCount > 0 ? plural(last.setCount, "set") : "Empty workout",
                last.presetName ?? brief(last.movements, 2),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
          </Link>
        )}
        <Link to="/body-weight" className="flex min-h-14 items-center gap-3 py-3">
          <Scale className="h-[18px] w-[18px] shrink-0 text-faint" aria-hidden="true" />
          <span className="sr-only">Body weight</span>
          <span className="num min-w-0 flex-1 truncate text-sm text-chalk">
            {bodyWeight === null ? "Log your body weight" : `${numberFormat.format(bodyWeight)} ${weightUnit}`}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
        </Link>
      </Card>
    </div>
  );
}

/** The workout in progress, with its running clock: the first thing on Home while one is open. */
function Resume({ workout }: { workout: NonNullable<Awaited<ReturnType<typeof getCurrentWorkoutServerFn>>> }) {
  const paused = !!workout.timeline && isPaused(workout.timeline);
  const now = useNow(1000, !paused);
  const at = now ?? Date.now();
  const seconds = workout.timeline
    ? elapsedMs(workout.timeline, at) / 1000
    : (at - new Date(workout.startedAt).getTime()) / 1000;
  return (
    <section className="enter enter-1" aria-label="Workout in progress">
      <Card className="space-y-4 border-primary/40 p-5">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-accent">In progress</p>
            <p className="truncate text-sm text-muted">
              {workout.plan?.title ?? "Workout"} · {plural(workout.sets.length, "set")} logged
            </p>
          </div>
          <p
            className={cn(
              "num text-4xl font-bold tracking-tight font-stretch-[88%] text-chalk",
              paused && "clock-hold",
            )}
            suppressHydrationWarning>
            {now === null ? "0:00" : formatClock(seconds)}
          </p>
        </div>
        <Link to="/current-workout" className={buttonClasses({ size: "lg", className: "h-14 w-full text-base" })}>
          <Play className="h-4 w-4 fill-current" />
          Resume workout
        </Link>
      </Card>
    </section>
  );
}
