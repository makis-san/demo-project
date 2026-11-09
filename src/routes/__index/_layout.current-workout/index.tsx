import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDate, formatTime, fullDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  createWorkoutServerFn,
  completeWorkoutServerFn,
  addSetServerFn,
  deleteSetServerFn,
} from "@/lib/workouts.server";
import { Play, Check, Plus, X } from "lucide-react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { currentWorkoutQueryOptions, movementsQueryOptions } from "./-queries/current-workout";
import { progressionQueryKey, workoutHistoryQueryKey } from "../_layout.workout-history/-queries/workout-history";
import { latestBodyWeightQueryOptions } from "../_layout.body-weight/-queries/body-weight";
import { weightUnit } from "@/lib/units";
import { PageHeader } from "@/components/page-header";
import { Stat } from "@/components/stat";

const volumeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const Route = createFileRoute("/__index/_layout/current-workout/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(currentWorkoutQueryOptions()),
      context.queryClient.ensureQueryData(movementsQueryOptions()),
      context.queryClient.ensureQueryData(latestBodyWeightQueryOptions()),
    ]);
  },
  component: CurrentWorkoutPage,
});

function CurrentWorkoutPage() {
  const { timeZone } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: workout } = useSuspenseQuery(currentWorkoutQueryOptions());
  const { data: movements } = useSuspenseQuery(movementsQueryOptions());
  const { data: latestBodyWeight } = useSuspenseQuery(latestBodyWeightQueryOptions());
  const [selectedMovement, setSelectedMovement] = useState("");
  const [reps, setReps] = useState("");
  const [weight, setWeight] = useState("");
  // True while the weight field holds the body weight we filled in, not something the user typed.
  const [weightIsBodyWeight, setWeightIsBodyWeight] = useState(false);

  const selected = movements.find((m) => m.id === selectedMovement);
  const needsBodyWeight = !!selected?.isBodyWeight && latestBodyWeight === null;

  const handleMovementChange = (movementId: string) => {
    setSelectedMovement(movementId);
    const movement = movements.find((m) => m.id === movementId);
    if (movement?.isBodyWeight && latestBodyWeight !== null) {
      // Keep a weight the user typed, for example the added weight on dips.
      if (weight === "" || weightIsBodyWeight) {
        setWeight(String(latestBodyWeight));
        setWeightIsBodyWeight(true);
      }
    } else if (weightIsBodyWeight) {
      setWeight("");
      setWeightIsBodyWeight(false);
    }
  };

  // A server function refuses when the page is out of date, for example when another tab already completed the
  // workout or removed the set. Reload the workout when an action fails too, so the page shows what the server has.
  // This is onSettled and not onError because a mutation's own onError replaces the one in router.tsx that shows
  // the toast, and onSettled leaves it alone.
  const refreshWorkout = () => queryClient.invalidateQueries({ queryKey: currentWorkoutQueryOptions().queryKey });

  const createWorkoutMutation = useMutation({
    mutationFn: () => createWorkoutServerFn(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: currentWorkoutQueryOptions().queryKey });
    },
  });

  // A server function answers { success: false, error } for failures it expects. Throwing here makes the
  // mutation fail, so the toast in router.tsx shows the message, and onSuccess does not run.
  const completeWorkoutMutation = useMutation({
    mutationFn: async () => {
      const result = await completeWorkoutServerFn();
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      // A completed workout now belongs in the history page and its charts.
      queryClient.invalidateQueries({ queryKey: workoutHistoryQueryKey });
      queryClient.invalidateQueries({ queryKey: progressionQueryKey });
    },
    onSettled: refreshWorkout,
  });

  const addSetMutation = useMutation({
    mutationFn: async (data: { movementId: string; reps: number; weight: number }) => {
      const result = await addSetServerFn({ data });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => setReps(""),
    onSettled: refreshWorkout,
  });

  const deleteSetMutation = useMutation({
    mutationFn: async (setId: string) => {
      const result = await deleteSetServerFn({ data: { setId } });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSettled: refreshWorkout,
  });

  const handleAddSet = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMovement || !reps || !weight) return;
    addSetMutation.mutate({
      movementId: selectedMovement,
      reps: parseInt(reps),
      weight: parseFloat(weight),
    });
  };

  if (!workout) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Today" title="Current Workout" />
        <Card className="enter enter-1 overflow-hidden">
          <div className="relative flex flex-col items-start gap-6 p-7 sm:p-10">
            <div aria-hidden="true" className="flex w-40 flex-col gap-2.5 opacity-90">
              <span className="h-3 w-full rounded-full bg-primary" />
              <span className="h-3 w-[70%] rounded-full bg-primary/60" />
              <span className="h-3 w-[40%] rounded-full bg-primary/30" />
            </div>
            <div className="space-y-2">
              <p className="text-2xl font-semibold tracking-tight font-stretch-[112%] text-chalk sm:text-3xl">
                No active workout. Ready to start?
              </p>
              <p className="max-w-md text-sm text-muted">
                Start a session, then log each set as you finish it. Everything you lift lands in your history.
              </p>
            </div>
            <Button onClick={() => createWorkoutMutation.mutate()} size="lg">
              <Play className="h-4 w-4 fill-current" />
              {createWorkoutMutation.isPending ? "Starting..." : "Start Workout"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const volume = workout.sets.reduce((sum, set) => sum + set.weight * set.reps, 0);
  const movementCount = new Set(workout.sets.map((set) => set.movement.id)).size;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`In progress · started ${formatTime(workout.startedAt, timeZone)}`}
        title="Current Workout"
        actions={
          <Button variant="outline" onClick={() => completeWorkoutMutation.mutate()}>
            <Check className="h-4 w-4" />
            {completeWorkoutMutation.isPending ? "Completing..." : "Complete Workout"}
          </Button>
        }
      />

      <Card className="enter enter-1">
        <CardHeader className="gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <p className="eyebrow">Session</p>
            <CardTitle className="text-xl sm:text-2xl">{formatDate(workout.startedAt, timeZone, fullDate)}</CardTitle>
          </div>
          <div className="grid grid-cols-3 gap-6 sm:gap-10">
            <Stat label="Sets" value={workout.sets.length} />
            <Stat label="Movements" value={movementCount} />
            <Stat label="Volume" value={volumeFormat.format(volume)} unit={weightUnit} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <form
            onSubmit={handleAddSet}
            className="grid gap-2 rounded-[1.375rem] border border-line bg-black/20 p-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_6.5rem_auto]">
            <Select
              aria-label="Movement"
              value={selectedMovement}
              onChange={(e) => handleMovementChange(e.target.value)}>
              <option value="">Select movement</option>
              {movements.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              aria-label="Weight"
              placeholder={`Weight (${weightUnit})`}
              inputMode="decimal"
              value={weight}
              onChange={(e) => {
                setWeight(e.target.value);
                setWeightIsBodyWeight(false);
              }}
              min={0}
              max={9999.99}
              step="0.01"
            />
            <Input
              type="number"
              aria-label="Reps"
              placeholder="Reps"
              inputMode="numeric"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              min={1}
              max={1000}
            />
            <Button type="submit" disabled={!selectedMovement || !reps || !weight} className="h-12">
              <Plus className="h-4 w-4" />
              {addSetMutation.isPending ? "Adding..." : "Add"}
            </Button>
          </form>
          {needsBodyWeight && (
            <p className="px-2 text-sm text-muted">
              No body weight recorded yet. Enter a weight, or{" "}
              <Link to="/body-weight" className="text-primary underline-offset-4 hover:underline">
                log your body weight
              </Link>{" "}
              to have it filled in.
            </p>
          )}
          {workout.sets.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
              No sets yet. Add exercises to your workout!
            </p>
          ) : (
            <ul className="setlist space-y-1.5">
              {workout.sets.map((set) => (
                <li
                  key={set.id}
                  className="flex items-center gap-3 rounded-2xl bg-well py-2 pr-2 pl-4 transition-colors hover:bg-white/[0.07]">
                  <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                    <span className="truncate font-medium text-chalk">{set.movement.name}</span>
                    <span className="num whitespace-nowrap text-sm text-muted">
                      <span className="text-base font-semibold text-chalk">{set.reps}</span> reps ×{" "}
                      <span className="text-base font-semibold text-chalk">{set.weight}</span> {weightUnit}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${set.movement.name} set`}
                    onClick={() => deleteSetMutation.mutate(set.id)}
                    className="h-10 w-10 text-faint hover:text-danger">
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
