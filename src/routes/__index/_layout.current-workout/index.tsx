import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDate, fullDate } from "@/lib/dates";
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
import { progressionQueryKey, workoutHistoryQueryOptions } from "../_layout.workout-history/-queries/workout-history";
import { latestBodyWeightQueryOptions } from "../_layout.body-weight/-queries/body-weight";

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

  const createWorkoutMutation = useMutation({
    mutationFn: () => createWorkoutServerFn(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: currentWorkoutQueryOptions().queryKey });
    },
  });

  const completeWorkoutMutation = useMutation({
    mutationFn: () => completeWorkoutServerFn(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: currentWorkoutQueryOptions().queryKey });
      // A completed workout now belongs in the history page and its charts.
      queryClient.invalidateQueries({ queryKey: workoutHistoryQueryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: progressionQueryKey });
    },
  });

  const addSetMutation = useMutation({
    mutationFn: (data: { movementId: string; reps: number; weight: number }) => addSetServerFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: currentWorkoutQueryOptions().queryKey });
      setReps("");
    },
  });

  const deleteSetMutation = useMutation({
    mutationFn: (setId: string) => deleteSetServerFn({ data: { setId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: currentWorkoutQueryOptions().queryKey });
    },
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
        <h1 className="text-2xl font-semibold text-slate-900">Current Workout</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-slate-500 mb-4">No active workout. Ready to start?</p>
            <Button onClick={() => createWorkoutMutation.mutate()} size="lg">
              <Play className="w-4 h-4 mr-2" />
              {createWorkoutMutation.isPending ? "Starting..." : "Start Workout"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Current Workout</h1>
        <Button variant="outline" onClick={() => completeWorkoutMutation.mutate()}>
          <Check className="w-4 h-4 mr-2" />
          {completeWorkoutMutation.isPending ? "Completing..." : "Complete Workout"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{formatDate(workout.startedAt, timeZone, fullDate)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleAddSet} className="flex gap-2 items-center">
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
              placeholder="Weight"
              value={weight}
              onChange={(e) => {
                setWeight(e.target.value);
                setWeightIsBodyWeight(false);
              }}
              className="w-24"
              min={0}
              max={9999.99}
              step="0.01"
            />
            <Input
              type="number"
              aria-label="Reps"
              placeholder="Reps"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              className="w-24"
              min={1}
              max={1000}
            />
            <Button type="submit" disabled={!selectedMovement || !reps || !weight} size="sm">
              <Plus className="w-4 h-4 mr-1" />
              {addSetMutation.isPending ? "Adding..." : "Add"}
            </Button>
          </form>
          {needsBodyWeight && (
            <p className="text-sm text-slate-500">
              No body weight recorded yet. Enter a weight, or{" "}
              <Link to="/body-weight" className="text-primary hover:underline">
                log your body weight
              </Link>{" "}
              to have it filled in.
            </p>
          )}
          {workout.sets.length === 0 ? (
            <p className="text-sm text-slate-500">No sets yet. Add exercises to your workout!</p>
          ) : (
            <ul className="space-y-2">
              {workout.sets.map((set) => (
                <li key={set.id} className="px-3 py-2 bg-slate-50 rounded-lg text-sm flex items-center justify-between">
                  <div>
                    <span className="font-medium">{set.movement.name}</span>
                    <span className="text-slate-500 ml-2">
                      {set.reps} reps × {set.weight} lbs
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${set.movement.name} set`}
                    onClick={() => deleteSetMutation.mutate(set.id)}
                    className="h-8 w-8 text-slate-400">
                    <X className="w-4 h-4" />
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
