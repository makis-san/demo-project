import { Fragment, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { formatDate, shortDate } from "@/lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { deleteWorkoutsServerFn } from "@/lib/workouts.server";
import { ChevronRight, Repeat2, Trash2 } from "lucide-react";
import { useIsPhone } from "@/lib/use-media-query";
import { SetValues } from "@/components/set-values";
import { cn } from "@/lib/utils";
import { currentWorkoutQueryOptions } from "../_layout.current-workout/-queries/current-workout";
import { MusclesWorked } from "./-muscles-worked";
import {
  historyMovementsQueryOptions,
  muscleLoadQueryOptions,
  progressionQueryKey,
  progressionQueryOptions,
  trainingCalendarQueryOptions,
  workoutHistoryQueryKey,
  workoutHistoryQueryOptions,
} from "./-queries/workout-history";
import { ProgressionChart } from "./-progression-chart";
import { TrainingCalendar } from "./-training-calendar";
import {
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { weightUnit } from "@/lib/units";
import { PageHeader } from "@/components/page-header";

const headClass = "whitespace-nowrap px-3 py-3 text-xs font-medium text-muted";

export const Route = createFileRoute("/__index/_layout/workout-history/")({
  loader: async ({ context }) => {
    const [, movements] = await Promise.all([
      context.queryClient.ensureInfiniteQueryData(workoutHistoryQueryOptions()),
      context.queryClient.ensureQueryData(historyMovementsQueryOptions()),
      context.queryClient.ensureQueryData(trainingCalendarQueryOptions(context.timeZone)),
      context.queryClient.ensureQueryData(muscleLoadQueryOptions(context.timeZone)),
    ]);
    // Fetch the chart for the movement that is selected first, so it is in the server-rendered page.
    const first = movements[0];
    if (first) await context.queryClient.ensureQueryData(progressionQueryOptions(first.id, context.timeZone));
  },
  component: WorkoutHistoryPage,
});

function WorkoutHistoryPage() {
  const { timeZone } = Route.useRouteContext();
  const queryClient = useQueryClient();
  // The pages loaded so far, newest first. "Load more" adds the next page at the end.
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useSuspenseInfiniteQuery(workoutHistoryQueryOptions());
  const workouts = data.pages.flatMap((page) => page.workouts);
  // Every movement in a completed workout, not only those on the pages loaded so far. The columns
  // of the table are the same on every page, and the chart can pick any movement.
  const { data: movements } = useSuspenseQuery(historyMovementsQueryOptions());
  const [selectedWorkouts, setSelectedWorkouts] = useState<Set<string>>(new Set());
  // Workouts whose sets are open, to read or to correct a typo in them.
  const [openWorkouts, setOpenWorkouts] = useState<Set<string>>(new Set());
  // On a phone the completed workouts are a list, and Select turns on the checkboxes. The table is for md and up.
  const [selecting, setSelecting] = useState(false);
  const phone = useIsPhone();
  const navigate = useNavigate();
  // Only one workout can be active, so a repeat is offered only while there is none.
  const { data: activeWorkout } = useQuery(currentWorkoutQueryOptions());
  const hasActiveWorkout = !!activeWorkout;

  const toggleOpen = (id: string) =>
    setOpenWorkouts((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const deleteWorkoutsMutation = useMutation({
    mutationFn: (workoutIds: string[]) => deleteWorkoutsServerFn({ data: { workoutIds } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workoutHistoryQueryKey });
      queryClient.invalidateQueries({ queryKey: progressionQueryKey });
      // The active workout may be a repeat of one of these, and its checklist goes with the source.
      queryClient.invalidateQueries({ queryKey: currentWorkoutQueryOptions().queryKey });
      setSelectedWorkouts(new Set());
      setSelecting(false);
    },
  });

  const toggleWorkout = (id: string) => {
    setSelectedWorkouts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedWorkouts.size === workouts.length) {
      setSelectedWorkouts(new Set());
    } else {
      setSelectedWorkouts(new Set(workouts.map((w) => w.id)));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedWorkouts.size === 0) return;
    deleteWorkoutsMutation.mutate(Array.from(selectedWorkouts));
  };

  return (
    // A column, so that on a phone the journal comes right after the calendar and the charts follow it.
    <div className="flex flex-col gap-6">
      <PageHeader title="Workout History" />

      <TrainingCalendar timeZone={timeZone} />

      <div className="max-md:order-2">
        <MusclesWorked timeZone={timeZone} />
      </div>

      {movements.length > 0 && (
        <div className="max-md:order-2">
          <ProgressionChart
            // Reset the selection if the chosen movement disappears, for example after deleting workouts.
            key={movements.map((m) => m.id).join(",")}
            movements={movements}
            timeZone={timeZone}
          />
        </div>
      )}

      <Card className="enter enter-2 max-md:border-0 max-md:shadow-none max-md:[backdrop-filter:none] max-md:[background:none]">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 max-md:p-0 max-md:pb-3">
          <CardTitle>Completed workouts</CardTitle>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleDeleteSelected}
            disabled={selectedWorkouts.size === 0}
            className="max-md:hidden">
            <Trash2 className="h-4 w-4" />
            {deleteWorkoutsMutation.isPending ? "Deleting..." : `Delete Selected (${selectedWorkouts.size})`}
          </Button>
          {workouts.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelecting((on) => !on);
                setSelectedWorkouts(new Set());
              }}
              className="press h-11 rounded-full px-4 text-sm font-semibold text-accent md:hidden">
              {selecting ? "Done" : "Select"}
            </button>
          )}
        </CardHeader>
        <CardContent className="max-md:p-0">
          {workouts.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
              No completed workouts yet.
            </p>
          ) : (
            <>
              {hasActiveWorkout && (
                <p className="mb-3 px-1 text-xs text-faint">Finish your workout in progress to repeat a past one.</p>
              )}
              <WorkoutJournal
                workouts={workouts}
                timeZone={timeZone}
                phone={phone}
                open={openWorkouts}
                onToggleOpen={toggleOpen}
                selecting={selecting}
                selected={selectedWorkouts}
                onToggleSelected={toggleWorkout}
                canRepeat={!hasActiveWorkout}
                onRepeat={(id) => navigate({ to: "/start-workout", search: { preset: undefined, from: id } })}
              />
              <div className="-mx-2 hidden overflow-x-auto rounded-2xl md:block">
                <table className="num w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="whitespace-nowrap px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label="Select all workouts"
                          checked={selectedWorkouts.size === workouts.length}
                          onChange={toggleAll}
                          className="h-4 w-4 cursor-pointer"
                        />
                      </th>
                      <th className={headClass + " text-left"}>Date</th>
                      <th className={headClass + " text-right"}>Sets</th>
                      {movements.map(({ id, name }) => (
                        <th key={id} className={headClass + " text-right"}>
                          {name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {workouts.map((workout) => {
                      const setsByMovement = new Map<string, typeof workout.sets>();
                      workout.sets.forEach((set) => {
                        const existing = setsByMovement.get(set.movement.id) || [];
                        setsByMovement.set(set.movement.id, [...existing, set]);
                      });

                      const isSelected = selectedWorkouts.has(workout.id);
                      return (
                        <Fragment key={workout.id}>
                          <tr
                            className={`border-b border-line last:border-0 transition-colors ${isSelected ? "bg-primary/10" : "hover:bg-white/[0.04]"}`}>
                            <td className="whitespace-nowrap px-3 py-3.5">
                              <input
                                type="checkbox"
                                aria-label="Select workout"
                                checked={selectedWorkouts.has(workout.id)}
                                onChange={() => toggleWorkout(workout.id)}
                                className="h-4 w-4 cursor-pointer"
                              />
                            </td>
                            <td className="whitespace-nowrap px-3 py-3.5 font-medium text-chalk">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  aria-expanded={openWorkouts.has(workout.id)}
                                  aria-label={`${openWorkouts.has(workout.id) ? "Hide" : "Show"} the sets of this workout`}
                                  onClick={() => toggleOpen(workout.id)}
                                  className="press grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint hover:bg-white/[0.07] hover:text-chalk">
                                  <ChevronRight
                                    className={cn(
                                      "h-4 w-4 transition-transform",
                                      openWorkouts.has(workout.id) && "rotate-90",
                                    )}
                                  />
                                </button>
                                <span>
                                  {workout.completedAt ? formatDate(workout.completedAt, timeZone, shortDate) : "-"}
                                </span>
                                <button
                                  type="button"
                                  aria-label="Repeat this workout"
                                  title={
                                    hasActiveWorkout
                                      ? "Finish your current workout first"
                                      : "See this workout again, and start it when you are ready"
                                  }
                                  disabled={hasActiveWorkout || workout.sets.length === 0}
                                  onClick={() =>
                                    navigate({ to: "/start-workout", search: { preset: undefined, from: workout.id } })
                                  }
                                  className="press grid h-8 w-8 shrink-0 place-items-center rounded-full text-accent hover:bg-white/[0.07] disabled:pointer-events-none disabled:opacity-30">
                                  <Repeat2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-3.5 text-right text-muted">
                              {workout.sets.length}
                            </td>
                            {movements.map(({ id: movementId }) => {
                              const movementSets = setsByMovement.get(movementId);
                              if (!movementSets || movementSets.length === 0) {
                                return (
                                  <td
                                    key={movementId}
                                    className="whitespace-nowrap px-3 py-3.5 text-right text-faint/60">
                                    -
                                  </td>
                                );
                              }
                              const maxWeight = Math.max(...movementSets.map((s) => s.weight));
                              const avgReps = Math.round(
                                movementSets.reduce((sum, s) => sum + s.reps, 0) / movementSets.length,
                              );
                              const numSets = movementSets.length;
                              return (
                                <td key={movementId} className="whitespace-nowrap px-3 py-3.5 text-right text-muted">
                                  <span className="font-semibold text-chalk">
                                    {maxWeight} {weightUnit}
                                  </span>{" "}
                                  / {avgReps} reps / {numSets} sets
                                </td>
                              );
                            })}
                          </tr>
                          {openWorkouts.has(workout.id) && !phone && (
                            <tr className="border-b border-line last:border-0 bg-black/15">
                              <td colSpan={movements.length + 3} className="px-3 py-3">
                                <WorkoutSets sets={workout.sets} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {hasNextPage && (
                <div className="mt-5 text-center">
                  <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                    {isFetchingNextPage ? "Loading..." : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {/* Outside the card: its entrance animation would make it the box a fixed bar is placed in. */}
      {selecting && phone && (
        <div className="glass glass-strong fixed inset-x-3 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5.25rem)] z-30 rounded-[1.5rem] p-2">
          <Button
            variant="destructive"
            onClick={handleDeleteSelected}
            disabled={selectedWorkouts.size === 0}
            className="h-12 w-full text-base">
            <Trash2 className="h-4 w-4" />
            {deleteWorkoutsMutation.isPending ? "Deleting..." : `Delete Selected (${selectedWorkouts.size})`}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The sets of one completed workout, grouped by movement, each one editable in place. */
function WorkoutSets({
  sets,
}: {
  sets: { id: string; reps: number; weight: number; movement: { id: string; name: string } }[];
}) {
  if (sets.length === 0) return <p className="text-sm text-muted">This workout has no sets.</p>;
  const groups: { name: string; id: string; sets: typeof sets }[] = [];
  for (const set of sets) {
    const group = groups.find((g) => g.id === set.movement.id);
    if (group) group.sets.push(set);
    else groups.push({ id: set.movement.id, name: set.movement.name, sets: [set] });
  }
  return (
    <div className="space-y-3 text-sm" aria-label="Sets of this workout" role="group">
      {groups.map((group) => (
        <div key={group.id}>
          <p className="px-1 pb-1 font-semibold text-muted">{group.name}</p>
          <ul className="space-y-1">
            {group.sets.map((set, i) => (
              <li key={set.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-well py-1 pr-2 pl-3">
                <span className="num w-11 shrink-0 text-xs font-semibold text-faint" aria-hidden="true">
                  SET {i + 1}
                </span>
                <SetValues set={set} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------ */

type JournalWorkout = {
  id: string;
  completedAt: Date | string | null;
  presetName: string | null;
  sets: { id: string; reps: number; weight: number; movement: { id: string; name: string } }[];
};

const volumeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dayMs = 86_400_000;
const localDay = (value: Date | string, timeZone: string) =>
  Date.parse(`${new Date(value).toLocaleDateString("en-CA", { timeZone })}T00:00:00Z`) / dayMs;
/** The Monday of the week a day (counted in days since 1970) is in. */
const weekOf = (day: number) => day - ((new Date(day * dayMs).getUTCDay() + 6) % 7);
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function weekLabel(week: number, thisWeek: number) {
  if (week === thisWeek) return "This week";
  if (week === thisWeek - 7) return "Last week";
  const start = new Date(week * dayMs);
  const end = new Date((week + 6) * dayMs);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  return `${monthDay.format(start)} – ${sameMonth ? end.getUTCDate() : monthDay.format(end)}`;
}

/**
 * The completed workouts on a phone, as a journal: grouped by week, one row each with its date, preset, sets and
 * volume, and a small bar for the volume next to the biggest on the page. Tap a row to open its sets (and Repeat).
 * Select turns the rows into choices, with a bar to delete the chosen ones. From md up the table does all of this,
 * and this list is not on the screen.
 */
function WorkoutJournal({
  workouts,
  timeZone,
  phone,
  open,
  onToggleOpen,
  selecting,
  selected,
  onToggleSelected,
  canRepeat,
  onRepeat,
}: {
  workouts: JournalWorkout[];
  timeZone: string;
  /** Only the open sets and the checkboxes are drawn in the page when this is the layout in use, so tests find one. */
  phone: boolean;
  open: Set<string>;
  onToggleOpen: (id: string) => void;
  selecting: boolean;
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  canRepeat: boolean;
  onRepeat: (id: string) => void;
}) {
  const thisWeek = weekOf(Date.now() / dayMs);
  const rows = workouts.map((workout) => ({
    workout,
    week: workout.completedAt ? weekOf(localDay(workout.completedAt, timeZone)) : 0,
    volume: workout.sets.reduce((sum, set) => sum + set.weight * set.reps, 0),
  }));
  const biggest = Math.max(1, ...rows.map((row) => row.volume));
  const groups: { week: number; rows: typeof rows }[] = [];
  for (const row of rows) {
    const group = groups.at(-1);
    if (group && group.week === row.week) group.rows.push(row);
    else groups.push({ week: row.week, rows: [row] });
  }

  return (
    <div className={cn("space-y-6 md:hidden", selecting && "pb-24")}>
      {groups.map((group) => (
        <section key={group.week} aria-label={weekLabel(group.week, thisWeek)}>
          <h3 className="px-1 pb-2 text-[13px] font-medium text-muted">{weekLabel(group.week, thisWeek)}</h3>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-well">
            {group.rows.map(({ workout, volume }) => {
              const isOpen = open.has(workout.id) && phone && !selecting;
              const isSelected = selected.has(workout.id);
              const date = workout.completedAt
                ? formatDate(workout.completedAt, timeZone, { weekday: "short", month: "short", day: "numeric" })
                : "-";
              const summary = (
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-semibold text-chalk">{date}</span>
                    {workout.presetName && <span className="truncate text-sm text-muted">{workout.presetName}</span>}
                  </span>
                  <span className="num mt-0.5 block text-sm text-muted">
                    {workout.sets.length} {workout.sets.length === 1 ? "set" : "sets"} · {volumeFormat.format(volume)}{" "}
                    {weightUnit}
                  </span>
                  <span aria-hidden="true" className="mt-2 block h-1 overflow-hidden rounded-full bg-white/[0.07]">
                    <span
                      className="block h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.max(volume > 0 ? 3 : 0, (volume / biggest) * 100)}%` }}
                    />
                  </span>
                </span>
              );
              return (
                <li key={workout.id} className={cn(isSelected && "bg-primary/10")}>
                  {selecting && phone ? (
                    <label className="flex min-h-16 cursor-pointer items-center gap-3 px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select workout"
                        checked={isSelected}
                        onChange={() => onToggleSelected(workout.id)}
                        className="h-6 w-6 shrink-0 cursor-pointer accent-primary"
                      />
                      {summary}
                    </label>
                  ) : (
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} the sets of this workout`}
                      onClick={() => onToggleOpen(workout.id)}
                      className="press flex min-h-16 w-full items-center gap-3 px-3 py-3 text-left">
                      {summary}
                      <ChevronRight
                        className={cn("h-4 w-4 shrink-0 text-faint transition-transform", isOpen && "rotate-90")}
                        aria-hidden="true"
                      />
                    </button>
                  )}
                  {isOpen && (
                    <div className="space-y-3 bg-black/15 px-3 py-3">
                      <WorkoutSets sets={workout.sets} />
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label="Repeat this workout"
                        disabled={!canRepeat || workout.sets.length === 0}
                        onClick={() => onRepeat(workout.id)}
                        className="h-11 w-full">
                        <Repeat2 className="h-4 w-4 text-accent" />
                        {canRepeat ? "Repeat" : "Finish your current workout first"}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
