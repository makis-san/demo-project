import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { formatDate, shortDate } from "@/lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { deleteWorkoutsServerFn } from "@/lib/workouts.server";
import { Trash2 } from "lucide-react";
import {
  historyMovementsQueryOptions,
  progressionQueryKey,
  progressionQueryOptions,
  workoutHistoryQueryKey,
  workoutHistoryQueryOptions,
} from "./-queries/workout-history";
import { ProgressionChart } from "./-progression-chart";
import { useSuspenseInfiniteQuery, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { weightUnit } from "@/lib/units";
import { PageHeader } from "@/components/page-header";

const headClass = "eyebrow whitespace-nowrap px-3 py-3 font-semibold";

export const Route = createFileRoute("/__index/_layout/workout-history/")({
  loader: async ({ context }) => {
    const [, movements] = await Promise.all([
      context.queryClient.ensureInfiniteQueryData(workoutHistoryQueryOptions()),
      context.queryClient.ensureQueryData(historyMovementsQueryOptions()),
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

  const deleteWorkoutsMutation = useMutation({
    mutationFn: (workoutIds: string[]) => deleteWorkoutsServerFn({ data: { workoutIds } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workoutHistoryQueryKey });
      queryClient.invalidateQueries({ queryKey: progressionQueryKey });
      setSelectedWorkouts(new Set());
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
    <div className="space-y-6">
      <PageHeader eyebrow="Review" title="Workout History" />

      {movements.length > 0 && (
        <ProgressionChart
          // Reset the selection if the chosen movement disappears, for example after deleting workouts.
          key={movements.map((m) => m.id).join(",")}
          movements={movements}
          timeZone={timeZone}
        />
      )}

      <Card className="enter enter-2">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="space-y-1.5">
            <p className="eyebrow">Log</p>
            <CardTitle>Completed Workouts</CardTitle>
          </div>
          <Button size="sm" variant="destructive" onClick={handleDeleteSelected} disabled={selectedWorkouts.size === 0}>
            <Trash2 className="h-4 w-4" />
            {deleteWorkoutsMutation.isPending ? "Deleting..." : `Delete Selected (${selectedWorkouts.size})`}
          </Button>
        </CardHeader>
        <CardContent>
          {workouts.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
              No completed workouts yet.
            </p>
          ) : (
            <>
              <div className="-mx-2 overflow-x-auto rounded-2xl">
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
                        <tr
                          key={workout.id}
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
                            {workout.completedAt ? formatDate(workout.completedAt, timeZone, shortDate) : "-"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-right text-muted">{workout.sets.length}</td>
                          {movements.map(({ id: movementId }) => {
                            const movementSets = setsByMovement.get(movementId);
                            if (!movementSets || movementSets.length === 0) {
                              return (
                                <td key={movementId} className="whitespace-nowrap px-3 py-3.5 text-right text-faint/60">
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
    </div>
  );
}
