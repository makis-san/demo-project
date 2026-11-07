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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Workout History</h1>
      </div>

      {movements.length > 0 && (
        <ProgressionChart
          // Reset the selection if the chosen movement disappears, for example after deleting workouts.
          key={movements.map((m) => m.id).join(",")}
          movements={movements}
          timeZone={timeZone}
        />
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Completed Workouts</CardTitle>
          <Button size="sm" variant="destructive" onClick={handleDeleteSelected} disabled={selectedWorkouts.size === 0}>
            <Trash2 className="w-4 h-4 mr-2" />
            {deleteWorkoutsMutation.isPending ? "Deleting..." : `Delete Selected (${selectedWorkouts.size})`}
          </Button>
        </CardHeader>
        <CardContent>
          {workouts.length === 0 ? (
            <p className="text-sm text-slate-500">No completed workouts yet.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="whitespace-nowrap py-3 px-4">
                        <input
                          type="checkbox"
                          aria-label="Select all workouts"
                          checked={selectedWorkouts.size === workouts.length}
                          onChange={toggleAll}
                          className="rounded border-gray-300"
                        />
                      </th>
                      <th className="text-left whitespace-nowrap py-3 px-4 font-medium text-slate-600">Date</th>
                      <th className="text-right whitespace-nowrap py-3 px-4 font-medium text-slate-600">Sets</th>
                      {movements.map(({ id, name }) => (
                        <th key={id} className="text-right whitespace-nowrap py-3 px-4 font-medium text-slate-600">
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
                          className={`border-b border-slate-100 ${isSelected ? "bg-primary/10" : "hover:bg-slate-50"}`}>
                          <td className="whitespace-nowrap py-3 px-4">
                            <input
                              type="checkbox"
                              aria-label="Select workout"
                              checked={selectedWorkouts.has(workout.id)}
                              onChange={() => toggleWorkout(workout.id)}
                              className="rounded border-gray-300"
                            />
                          </td>
                          <td className="whitespace-nowrap py-3 px-4 text-slate-500">
                            {workout.completedAt ? formatDate(workout.completedAt, timeZone, shortDate) : "-"}
                          </td>
                          <td className="whitespace-nowrap py-3 px-4 text-right text-slate-600">
                            {workout.sets.length}
                          </td>
                          {movements.map(({ id: movementId }) => {
                            const movementSets = setsByMovement.get(movementId);
                            if (!movementSets || movementSets.length === 0) {
                              return (
                                <td key={movementId} className="whitespace-nowrap py-3 px-4 text-right text-slate-300">
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
                              <td key={movementId} className="whitespace-nowrap py-3 px-4 text-right text-slate-600">
                                {maxWeight} {weightUnit} / {avgReps} reps / {numSets} sets
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
                <div className="mt-4 text-center">
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
