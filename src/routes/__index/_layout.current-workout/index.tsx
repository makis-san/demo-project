import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDate, formatTime, fullDate, shortDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  createWorkoutServerFn,
  completeWorkoutServerFn,
  addSetServerFn,
  deleteSetServerFn,
} from "@/lib/workouts.server";
import { Play, Check } from "lucide-react";
import { useSuspenseQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { currentWorkoutQueryOptions } from "./-queries/current-workout";
import type { MovementOption } from "@/components/movement-picker";
import {
  progressionQueryKey,
  progressionQueryOptions,
  workoutHistoryQueryKey,
} from "../_layout.workout-history/-queries/workout-history";
import { latestBodyWeightQueryOptions } from "../_layout.body-weight/-queries/body-weight";
import { PageHeader } from "@/components/page-header";
import { RestTimerPill, useRestTimer } from "@/components/rest-timer";
import { buzz } from "@/lib/use-now";
import {
  personalRecords,
  PlannedSets,
  RecapCard,
  SessionCard,
  SetComposer,
  SetList,
  volumeOf,
  type LoggedSet,
  type MovementHistory,
  type Recap,
} from "./-workout-parts";

export const Route = createFileRoute("/__index/_layout/current-workout/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(currentWorkoutQueryOptions()),
      context.queryClient.ensureQueryData(latestBodyWeightQueryOptions()),
    ]);
  },
  component: CurrentWorkoutPage,
});

function CurrentWorkoutPage() {
  const { timeZone } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: workout } = useSuspenseQuery(currentWorkoutQueryOptions());
  const { data: latestBodyWeight } = useSuspenseQuery(latestBodyWeightQueryOptions());
  // The movement picked for the next set. The picker loads movements a page at a time, so the page keeps only this one.
  const [selected, setSelected] = useState<MovementOption | null>(null);
  const selectedMovement = selected?.id ?? "";
  const [reps, setReps] = useState("");
  const [weight, setWeight] = useState("");
  // True while the weight field holds the body weight we filled in, not something the user typed.
  const [weightIsBodyWeight, setWeightIsBodyWeight] = useState(false);
  const [recap, setRecap] = useState<Recap | null>(null);
  // The session's numbers, taken when Complete Workout is pressed, for the recap once the server agrees.
  const pendingRecap = useRef<Recap | null>(null);
  const timer = useRestTimer(workout?.id ?? null);
  const sets: LoggedSet[] = workout?.sets ?? [];

  // History for every movement in the session and the one picked: the last top set, the best, and so the PRs.
  // These are the chart's queries, so the history page reuses what this page fetched, and the other way round.
  const historyIds = useMemo(
    () => [...new Set([...sets.map((set) => set.movement.id), ...(selectedMovement ? [selectedMovement] : [])])],
    [sets, selectedMovement],
  );
  const historyQueries = useQueries({
    queries: historyIds.map((id) => ({ ...progressionQueryOptions(id, timeZone), enabled: !!workout })),
  });
  const history = new Map<string, MovementHistory>();
  historyIds.forEach((id, i) => {
    const data = historyQueries[i]?.data;
    if (!data) return;
    const last = data.days[data.days.length - 1];
    history.set(
      id,
      last
        ? { lastTop: last.maxWeight, lastDay: last.day, best: Math.max(...data.days.map((d) => d.maxWeight)) }
        : null,
    );
  });
  const prs = personalRecords(sets, history);

  const needsBodyWeight = !!selected?.isBodyWeight && latestBodyWeight === null;

  const handleMovementChange = (movement: MovementOption) => {
    setSelected(movement);
    if (movement.isBodyWeight && latestBodyWeight !== null) {
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
      setRecap(pendingRecap.current);
      timer.stop();
      buzz([30, 60, 30]);
    },
    onSettled: refreshWorkout,
  });

  // `fromForm` is false for a repeated set, so it doesn't clear reps the user is typing for the next one.
  const addSetMutation = useMutation({
    mutationFn: async ({
      fromForm: _,
      ...data
    }: {
      movementId: string;
      reps: number;
      weight: number;
      fromForm: boolean;
    }) => {
      const result = await addSetServerFn({ data });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: (_result, { fromForm }) => {
      if (fromForm) setReps("");
      buzz(12);
      timer.start();
    },
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

  // A chip from this session picks the movement and its last set, so the next set starts from there.
  const pickRecent = (set: Pick<LoggedSet, "movement" | "weight" | "reps">) => {
    setSelected(set.movement);
    setWeight(String(set.weight));
    setWeightIsBodyWeight(false);
    setReps(String(set.reps));
  };

  const completeWorkout = () => {
    if (workout) {
      pendingRecap.current = {
        seconds: (Date.now() - new Date(workout.startedAt).getTime()) / 1000,
        sets: sets.length,
        volume: volumeOf(sets),
        prs: prs.size,
      };
    }
    completeWorkoutMutation.mutate();
  };

  const handleAddSet = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMovement || !reps || !weight) return;
    addSetMutation.mutate({
      movementId: selectedMovement,
      reps: parseInt(reps),
      weight: parseFloat(weight),
      fromForm: true,
    });
  };

  if (!workout) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Today" title="Current Workout" />
        {recap && <RecapCard recap={recap} onDismiss={() => setRecap(null)} />}
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
                Start a session, then log each set as you finish it. A rest timer starts after every set.
              </p>
            </div>
            <Button onClick={() => createWorkoutMutation.mutate()} size="lg" className="w-full sm:w-auto">
              <Play className="h-4 w-4 fill-current" />
              {createWorkoutMutation.isPending ? "Starting..." : "Start Workout"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Newest first, one chip per movement.
  const recent: { movement: LoggedSet["movement"]; last: LoggedSet }[] = [];
  for (const set of [...sets].reverse()) {
    if (!recent.some((r) => r.movement.id === set.movement.id)) recent.push({ movement: set.movement, last: set });
  }
  const lastOfSelected = recent.find((r) => r.movement.id === selectedMovement)?.last;
  const selectedHistory = selectedMovement
    ? history.has(selectedMovement)
      ? history.get(selectedMovement)!
      : undefined
    : undefined;

  return (
    <div className={timer.rest ? "space-y-6 pb-24 md:pb-0" : "space-y-6"}>
      <PageHeader
        eyebrow={`In progress · started ${formatTime(workout.startedAt, timeZone)}`}
        title="Current Workout"
        actions={
          <Button variant="outline" onClick={completeWorkout}>
            <Check className="h-4 w-4" />
            {completeWorkoutMutation.isPending ? "Completing..." : "Complete Workout"}
          </Button>
        }
      />

      <SessionCard
        title={formatDate(workout.startedAt, timeZone, fullDate)}
        startedAt={workout.startedAt}
        sets={sets}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-6">
          <SetComposer
            selectedMovement={selected}
            onMovementChange={handleMovementChange}
            weight={weight}
            onWeightChange={(value) => {
              setWeight(value);
              setWeightIsBodyWeight(false);
            }}
            reps={reps}
            onRepsChange={setReps}
            onSubmit={handleAddSet}
            isPending={addSetMutation.isPending}
            needsBodyWeight={
              needsBodyWeight && (
                <p className="px-2 text-sm text-muted">
                  No body weight recorded yet. Enter a weight, or{" "}
                  <Link to="/body-weight" className="text-accent underline-offset-4 hover:underline">
                    log your body weight
                  </Link>{" "}
                  to have it filled in.
                </p>
              )
            }
            recent={recent}
            onPickRecent={pickRecent}
            history={selectedHistory}
            startWeight={lastOfSelected?.weight ?? selectedHistory?.lastTop}
            startReps={lastOfSelected?.reps}
            nextSetNumber={sets.filter((set) => set.movement.id === selectedMovement).length + 1}
            timer={timer}
          />
        </div>

        <div className="space-y-6">
          {workout.plan && workout.plan.sets.length > 0 && (
            <PlannedSets
              plan={workout.plan.sets}
              sourceDate={
                workout.plan.completedAt
                  ? formatDate(workout.plan.completedAt, timeZone, shortDate)
                  : "an earlier workout"
              }
              logged={sets}
              pending={addSetMutation.isPending}
              onAdjust={pickRecent}
              onLog={(planned) =>
                addSetMutation.mutate({
                  movementId: planned.movement.id,
                  reps: planned.reps,
                  weight: planned.weight,
                  fromForm: false,
                })
              }
            />
          )}
          {sets.length === 0 ? (
            <p className="glass rounded-panel px-6 py-12 text-center text-sm text-muted">
              No sets yet. Add exercises to your workout!
            </p>
          ) : (
            <SetList
              sets={sets}
              prs={prs}
              newestId={sets[sets.length - 1]?.id}
              onRemove={(set) => deleteSetMutation.mutate(set.id)}
              onRepeat={(set) =>
                addSetMutation.mutate({
                  movementId: set.movement.id,
                  reps: set.reps,
                  weight: set.weight,
                  fromForm: false,
                })
              }
              repeatPending={addSetMutation.isPending}
            />
          )}
        </div>
      </div>

      <RestTimerPill timer={timer} />
    </div>
  );
}
