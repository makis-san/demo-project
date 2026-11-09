import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, Library, Play } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Stat } from "@/components/stat";
import { WorkoutCard } from "@/components/workout-card";
import { formatDate, formatTime } from "@/lib/dates";
import { weightUnit } from "@/lib/units";
import { currentWorkoutQueryOptions } from "../_layout.current-workout/-queries/current-workout";
import { latestBodyWeightQueryOptions } from "../_layout.body-weight/-queries/body-weight";
import { TrainingCalendar } from "../_layout.workout-history/-training-calendar";
import { trainingCalendarQueryOptions } from "../_layout.workout-history/-queries/workout-history";
import { todayQueryOptions } from "../_layout.workout-library/-queries/presets";

export const Route = createFileRoute("/__index/_layout/home/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(currentWorkoutQueryOptions()),
      context.queryClient.ensureQueryData(todayQueryOptions(context.timeZone)),
      context.queryClient.ensureQueryData(trainingCalendarQueryOptions(context.timeZone)),
      context.queryClient.ensureQueryData(latestBodyWeightQueryOptions()),
    ]);
  },
  component: HomePage,
});

const dayMs = 24 * 60 * 60 * 1000;
const volumeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * The first screen: what to do today, and how training is going. The workouts planned for today (the workout of the day),
 * the workout in progress if there is one, this week's numbers and the training calendar.
 */
function HomePage() {
  const { timeZone } = Route.useRouteContext();
  const { data: workout } = useSuspenseQuery(currentWorkoutQueryOptions());
  const { data: today } = useSuspenseQuery(todayQueryOptions(timeZone));
  const { data: calendar } = useSuspenseQuery(trainingCalendarQueryOptions(timeZone));
  const { data: bodyWeight } = useSuspenseQuery(latestBodyWeightQueryOptions());

  // This week, Monday to today. Days are plain dates in the user's timezone, so the math is on UTC midnights.
  const todayTime = Date.parse(`${calendar.today}T00:00:00Z`);
  const monday = todayTime - ((new Date(todayTime).getUTCDay() + 6) % 7) * dayMs;
  const thisWeek = calendar.days.filter((d) => Date.parse(`${d.day}T00:00:00Z`) >= monday);
  const week = {
    workouts: thisWeek.reduce((sum, d) => sum + d.workouts, 0),
    sets: thisWeek.reduce((sum, d) => sum + d.sets, 0),
    volume: thisWeek.reduce((sum, d) => sum + d.volume, 0),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={formatDate(`${calendar.today}T12:00:00Z`, "UTC", { weekday: "long", month: "long", day: "numeric" })}
        title="Home"
      />

      {workout && (
        <Card className="enter enter-1 flex flex-wrap items-center gap-4 border-primary/40 p-4 sm:p-5">
          <div className="min-w-0 flex-1">
            <p className="eyebrow text-accent">In progress</p>
            <p className="text-lg font-semibold tracking-tight text-chalk font-stretch-[108%]">
              {workout.plan?.title ?? "Workout"} · started {formatTime(workout.startedAt, timeZone)}
            </p>
            <p className="num text-sm text-muted">
              {workout.sets.length} {workout.sets.length === 1 ? "set" : "sets"} logged
            </p>
          </div>
          <Link to="/current-workout" className={buttonClasses()}>
            Continue
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
      )}

      <section className="enter enter-1 space-y-3" aria-label="Workout of the day">
        <h2 className="eyebrow px-1">Workout of the day</h2>
        {today.workouts.length === 0 ? (
          <Card className="space-y-3 p-5 sm:p-6">
            <p className="text-base font-semibold text-chalk">Nothing planned for today.</p>
            <p className="text-sm text-muted">
              Pick the days a workout is planned for when you build it in your library, and it shows up here on those
              days.
            </p>
            <Link to="/workout-library" className={buttonClasses({ variant: "outline" })}>
              <Library className="h-4 w-4" />
              Open your workouts
            </Link>
          </Card>
        ) : (
          <ul className="space-y-3">
            {today.workouts.map((w) => (
              <li key={w.id}>
                <WorkoutCard
                  workout={w}
                  actions={
                    <Link
                      to="/start-workout"
                      search={{ preset: w.id, from: undefined }}
                      aria-label={`Start ${w.name}`}
                      className={buttonClasses({ variant: w.doneToday ? "ghost" : "default", size: "sm" })}>
                      <Play className="h-3.5 w-3.5 fill-current" />
                      {w.doneToday ? "Again" : "Start"}
                    </Link>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="enter enter-2 p-4 sm:p-6" aria-label="This week">
        <p className="eyebrow">This week</p>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          <Stat label="Workouts" value={week.workouts} morph />
          <Stat label="Sets" value={week.sets} morph />
          <Stat label="Volume" value={volumeFormat.format(week.volume)} unit={weightUnit} morph />
          <Stat
            label="Body weight"
            value={bodyWeight === null ? "–" : numberFormat.format(bodyWeight)}
            unit={bodyWeight === null ? undefined : weightUnit}
          />
        </div>
      </Card>

      <TrainingCalendar timeZone={timeZone} />
    </div>
  );
}
