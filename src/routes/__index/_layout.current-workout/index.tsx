import { weightUnit } from "@/lib/units";
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDate, formatTime, fullDate, shortDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { completeWorkoutServerFn, addSetServerFn, deleteSetServerFn } from "@/lib/workouts.server";
import { Library, Play, Plus } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { WorkoutCard } from "@/components/workout-card";
import { presetsQueryKey, todayQueryOptions } from "../_layout.workout-library/-queries/presets";
import { useSuspenseQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { currentWorkoutQueryOptions } from "./-queries/current-workout";
import { MovementBrowser } from "@/components/movement-browser";
import { Confetti } from "@/components/confetti";
import type { MovementOption } from "@/components/movement-card";
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
  plannedProgress,
  PlannedSets,
  RecapCard,
  RecentMovements,
  SetComposer,
  SetList,
  volumeOf,
  type LoggedSet,
  type MovementHistory,
  type PlannedSet,
  type Recap,
} from "./-workout-parts";
import { loggedCounts, movementColors, plannedGroups, WorkoutRing } from "./-workout-ring";
import { SwipePanes } from "@/components/swipe-panes";
import { useWorkoutTimeline } from "./-use-timeline";
import { currentSection, elapsedMs, isPaused, pause, resume, switchTo } from "@/lib/workout-timeline";

export const Route = createFileRoute("/__index/_layout/current-workout/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(currentWorkoutQueryOptions()),
      context.queryClient.ensureQueryData(latestBodyWeightQueryOptions()),
      context.queryClient.ensureQueryData(todayQueryOptions(context.timeZone)),
    ]);
  },
  component: CurrentWorkoutPage,
});

function CurrentWorkoutPage() {
  const { timeZone } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: workout } = useSuspenseQuery(currentWorkoutQueryOptions());
  const { data: latestBodyWeight } = useSuspenseQuery(latestBodyWeightQueryOptions());
  const { data: today } = useSuspenseQuery(todayQueryOptions(timeZone));
  // The movement picked for the next set. The picker loads movements a page at a time, so the page keeps only this one.
  const [selected, setSelected] = useState<MovementOption | null>(null);
  const selectedMovement = selected?.id ?? "";
  // The sheet that picks an extra movement: a bottom sheet on a phone, a modal on a desktop.
  const [choosing, setChoosing] = useState(false);
  // The sheet was opened by Add once the plan was done: the movement picked there resumes the workout.
  const [extending, setExtending] = useState(false);
  // Next was pressed with no planned movement left: the plan is over, even with sets skipped. See `complete`.
  const [ended, setEnded] = useState(false);
  // Counts up for each finished workout, so a new burst of confetti starts and the old one is replaced.
  const [confettiKey, setConfettiKey] = useState(0);
  const [reps, setReps] = useState("");
  const [weight, setWeight] = useState("");
  // True while the weight field holds the body weight we filled in, not something the user typed.
  const [weightIsBodyWeight, setWeightIsBodyWeight] = useState(false);
  const [recap, setRecap] = useState<Recap | null>(null);
  // The session's numbers, taken when Finish is pressed, for the recap once the server agrees.
  const pendingRecap = useRef<Recap | null>(null);
  const timer = useRestTimer(workout?.id ?? null);
  const sets: LoggedSet[] = workout?.sets ?? [];
  // The ring's timeline. A new one starts on the plan's first movement, or on the last one logged for a workout that
  // was open before the timeline existed.
  const timeline = useWorkoutTimeline(
    workout,
    workout?.plan?.sets[0]?.movement.id ?? workout?.sets.at(-1)?.movement.id ?? null,
  );
  /** Makes a movement the current section of the ring. Logging a set also ends a pause, since the user is training. */
  const moveTo = (movementId: string, { resumes = false } = {}) =>
    timeline.update((t, now) => {
      const switched = switchTo(t, movementId, now);
      return resumes ? resume(switched, now) : switched;
    });

  // The plan is done when every planned set is logged. The moment it gets there the workout pauses and the rest timer
  // goes, and the ring offers only Finish and Add (see `complete` below). Not on a reload of a workout already done.
  const planDone =
    !!workout?.plan &&
    workout.plan.sets.length > 0 &&
    plannedProgress(workout.plan.sets, sets).size === workout.plan.sets.length;
  const planWasDone = useRef<boolean | null>(null);
  useEffect(() => {
    const before = planWasDone.current;
    planWasDone.current = planDone;
    if (before === false && planDone) {
      timer.stop();
      timeline.update((t, now) => pause(t, now));
    }
    // Only when the plan becomes done.
  }, [planDone]);
  // Carrying on in any way (Add, or logging a set) ends the end of the plan.
  const running = !!timeline.timeline && !isPaused(timeline.timeline);
  useEffect(() => {
    if (running) setEnded(false);
  }, [running]);

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

  // On a phone the set form is in the Ring pane. Picking a movement from the List pane, a chip or the sheet slides there
  // and brings the form into view. Next is on the ring already, so it doesn't move the page.
  const showPane = useRef<((index: number) => void) | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const revealComposer = () => {
    showPane.current?.(0);
    window.setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 380);
  };

  const handleMovementChange = (movement: MovementOption, { reveal = true, resumes = false } = {}) => {
    setSelected(movement);
    moveTo(movement.id, { resumes });
    if (reveal) revealComposer();
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

  // A server function answers { success: false, error } for failures it expects. Throwing here makes the
  // mutation fail, so the toast in router.tsx shows the message, and onSuccess does not run.
  const completeWorkoutMutation = useMutation({
    mutationFn: async (finalTimeline: ReturnType<typeof timeline.finish>) => {
      const result = await completeWorkoutServerFn({ data: { timeline: finalTimeline } });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      // A completed workout now belongs in the history page and its charts.
      queryClient.invalidateQueries({ queryKey: workoutHistoryQueryKey });
      queryClient.invalidateQueries({ queryKey: progressionQueryKey });
      // A workout of the day that was just done shows as done.
      queryClient.invalidateQueries({ queryKey: presetsQueryKey });
      setRecap(pendingRecap.current);
      setConfettiKey((k) => k + 1);
      timer.stop();
      timeline.clear();
      buzz([30, 60, 30]);
    },
    onSettled: refreshWorkout,
  });

  // `fromForm` is false for a repeated set, so it doesn't clear reps the user is typing for the next one.
  const addSetMutation = useMutation({
    mutationFn: async ({
      fromForm: _fromForm,
      restSeconds: _restSeconds,
      ...data
    }: {
      movementId: string;
      reps: number;
      weight: number;
      fromForm: boolean;
      /** The rest a preset asks for after this set. Used by the rest timer only, never sent to the server. */
      restSeconds?: number | null;
    }) => {
      const result = await addSetServerFn({ data });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onMutate: ({ movementId }) => moveTo(movementId, { resumes: true }),
    onSuccess: (_result, { fromForm, restSeconds }) => {
      if (fromForm) setReps("");
      buzz(12);
      timer.start(restSeconds ?? undefined);
    },
    onSettled: refreshWorkout,
  });

  const logPlanned = (planned: PlannedSet) =>
    addSetMutation.mutate({
      movementId: planned.movement.id,
      reps: planned.reps,
      // The weight of a preset's series is optional. Without one a body-weight movement starts from the user's body
      // weight, like everywhere else, and any other is logged with 0 and can be adjusted.
      weight: planned.weight ?? (planned.movement.isBodyWeight && latestBodyWeight !== null ? latestBodyWeight : 0),
      fromForm: false,
      restSeconds: planned.restSeconds,
    });
  const repeatSet = (set: LoggedSet) =>
    addSetMutation.mutate({ movementId: set.movement.id, reps: set.reps, weight: set.weight, fromForm: false });

  const deleteSetMutation = useMutation({
    mutationFn: async (setId: string) => {
      const result = await deleteSetServerFn({ data: { setId } });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSettled: refreshWorkout,
  });

  // A chip from this session picks the movement and its last set, so the next set starts from there.
  const pickRecent = (set: Pick<LoggedSet, "movement" | "reps"> & { weight: number | null }) => {
    setSelected(set.movement);
    moveTo(set.movement.id);
    revealComposer();
    // A planned set may have no weight: leave it for the user, or start a body-weight movement from their body weight.
    const bodyWeight = set.weight === null && set.movement.isBodyWeight && latestBodyWeight !== null;
    setWeight(set.weight !== null ? String(set.weight) : bodyWeight ? String(latestBodyWeight) : "");
    setWeightIsBodyWeight(bodyWeight);
    setReps(String(set.reps));
  };

  const completeWorkout = () => {
    // The timeline closed now: the last section ends and a pause in progress ends with the workout.
    const finalTimeline = timeline.finish();
    if (workout) {
      pendingRecap.current = {
        // The time on the ring's clock, pauses left out.
        seconds: finalTimeline
          ? elapsedMs(finalTimeline, Date.now()) / 1000
          : (Date.now() - new Date(workout.startedAt).getTime()) / 1000,
        sets: sets.length,
        volume: volumeOf(sets),
        prs: prs.size,
      };
    }
    completeWorkoutMutation.mutate(finalTimeline);
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

  const confetti = confettiKey > 0 && <Confetti key={confettiKey} onDone={() => setConfettiKey(0)} />;

  if (!workout) {
    return (
      <div className="space-y-6">
        {confetti}
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
                Pick a workout and look at what is in it. Nothing starts, and no clock runs, until you press Start.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Link to="/workout-library" className={buttonClasses({ size: "lg", className: "w-full sm:w-auto" })}>
                <Library className="h-4 w-4" />
                Choose a workout
              </Link>
              <Link
                to="/start-workout"
                search={{ preset: undefined, from: undefined }}
                className={buttonClasses({ variant: "outline", size: "lg", className: "w-full sm:w-auto" })}>
                <Play className="h-4 w-4" />
                Empty workout
              </Link>
            </div>
          </div>
        </Card>
        {today.workouts.length > 0 && (
          <section className="enter enter-2 space-y-3" aria-label="Workout of the day">
            <h2 className="eyebrow px-1">Workout of the day</h2>
            {today.workouts.map((workout) => (
              <WorkoutCard key={workout.id} workout={workout} />
            ))}
          </section>
        )}
      </div>
    );
  }

  // Newest first, one chip per movement.
  const recent: { movement: LoggedSet["movement"]; last: LoggedSet }[] = [];
  for (const set of [...sets].reverse()) {
    if (!recent.some((r) => r.movement.id === set.movement.id)) recent.push({ movement: set.movement, last: set });
  }
  // Next walks the plan once, in order: it goes to the first planned movement not begun yet that has sets to do, and
  // never back to one already left, so pressing it again and again comes to an end. A skipped movement can still be
  // picked from the list or the sheet. With no planned movement left it ends the plan: the workout pauses on Finish
  // and Add, like a plan with every set done. Without a plan it opens the sheet to pick a movement.
  const groups = plannedGroups(workout.plan?.sets);
  const logged = loggedCounts(sets);
  const currentId = timeline.timeline ? currentSection(timeline.timeline).movementId : null;
  const begun = new Set([
    ...(timeline.timeline?.sections.map((section) => section.movementId) ?? []),
    ...sets.map((set) => set.movement.id),
  ]);
  const nextGroup = groups.find((g) => !begun.has(g.movement.id) && (logged.get(g.movement.id) ?? 0) < g.total);
  /** Next with nothing planned left: pause on Finish and Add. */
  const endPlan = () => {
    timer.stop();
    timeline.update((t, now) => pause(t, now));
    setEnded(true);
  };
  const goNext = () => {
    if (nextGroup) handleMovementChange(nextGroup.movement, { reveal: false }); else if (groups.length > 0) endPlan();
    else setChoosing(true);
  };
  const names = new Map<string, string>();
  for (const set of [...(workout.plan?.sets ?? []), ...sets]) names.set(set.movement.id, set.movement.name);
  if (selected) names.set(selected.id, selected.name);
  const colors = movementColors(timeline.timeline, groups);

  // Next set, the big Next: the current movement's next planned set, logged as planned. Once every planned set of the
  // movement is done it logs nothing more and moves on, like Next movement. Without a plan for the movement it repeats
  // its last set. With nothing to repeat it opens the set form for the numbers, and before any movement it opens the
  // sheet to pick one.
  const done = workout.plan ? plannedProgress(workout.plan.sets, sets) : new Set<string>();
  const nextPlanned = workout.plan?.sets.find((set) => set.movement.id === currentId && !done.has(set.id));
  const lastOfCurrent = [...sets].reverse().find((set) => set.movement.id === currentId);
  const setText = (set: { reps: number; weight: number | null }) =>
    `${set.reps} × ${set.weight === null ? "no weight" : `${set.weight} ${weightUnit}`}`;
  const movesOn = groups.some((g) => g.movement.id === currentId) && !nextPlanned;
  const nextSetDetail = !currentId
    ? "Pick a movement"
    : movesOn
      ? (nextGroup?.movement.name ?? "End of plan")
      : nextPlanned
        ? setText(nextPlanned)
        : lastOfCurrent
          ? `Again ${setText(lastOfCurrent)}`
          : "Type the numbers";
  const nextSet = () => {
    if (!currentId) return setChoosing(true);
    if (movesOn) return goNext();
    if (nextPlanned) return logPlanned(nextPlanned);
    if (lastOfCurrent) return repeatSet(lastOfCurrent);
    // A movement with no sets yet: the one picked in the sheet, or a planned one. Its form opens for the numbers.
    const movement =
      selected?.id === currentId ? selected : workout.plan?.sets.find((set) => set.movement.id === currentId)?.movement;
    if (movement) handleMovementChange(movement);
    else setChoosing(true);
  };
  const plannedLogged = workout.plan ? plannedProgress(workout.plan.sets, sets).size : 0;
  // The plan is done and the workout is paused on it: the ring offers Finish, or Add to carry on with another movement,
  // which resumes the clock. Resuming any other way (logging a set) brings the usual controls back.
  // A pause during a movement added after the plan is an ordinary pause, with Resume.
  const complete =
    !!timeline.timeline &&
    isPaused(timeline.timeline) &&
    (ended || (planDone && groups.some((g) => g.movement.id === currentId)));

  const lastOfSelected = recent.find((r) => r.movement.id === selectedMovement)?.last;
  const selectedHistory = selectedMovement
    ? history.has(selectedMovement)
      ? history.get(selectedMovement)!
      : undefined
    : undefined;

  return (
    <div className={timer.rest ? "space-y-6 pb-24 md:pb-0" : "space-y-6"}>
      {confetti}
      <PageHeader
        eyebrow={`In progress · started ${formatTime(workout.startedAt, timeZone)}`}
        title="Current Workout"
        nowrap
        actions={
          <Button
            variant="secondary"
            size="icon"
            aria-label="Add movement"
            title="Add movement"
            onClick={() => setChoosing(true)}
            className="group h-11 w-11 shrink-0">
            <Plus className="h-5 w-5 transition-transform duration-300 ease-out group-hover:rotate-90 group-active:scale-75" />
          </Button>
        }
      />

      <SwipePanes
        label="Workout views"
        controller={showPane}
        desktopClassName="lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-6"
        panes={[
          {
            id: "ring",
            label: "Ring",
            content: (
              <div className="space-y-4">
                <WorkoutRing
                  timeline={timeline.timeline}
                  title={formatDate(workout.startedAt, timeZone, fullDate)}
                  plan={workout.plan?.sets ?? null}
                  sets={sets}
                  names={names}
                  colors={colors}
                  defaultRestSeconds={timer.seconds}
                  nextName={nextGroup?.movement.name ?? null}
                  nextEndsPlan={!nextGroup && groups.length > 0}
                  onNext={goNext}
                  nextSetMovesOn={movesOn}
                  nextSetDetail={nextSetDetail}
                  onNextSet={nextSet}
                  nextSetPending={addSetMutation.isPending}
                  onTogglePause={() => timeline.update((t, now) => (isPaused(t) ? resume(t, now) : pause(t, now)))}
                  onFinish={completeWorkout}
                  finishing={completeWorkoutMutation.isPending}
                  complete={complete}
                  onAdd={() => {
                    setExtending(true);
                    setChoosing(true);
                  }}
                />
                {selected && (
                  <div ref={composerRef} className="scroll-mb-28">
                    <SetComposer
                      selectedMovement={selected}
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
                      history={selectedHistory}
                      startWeight={lastOfSelected?.weight ?? selectedHistory?.lastTop}
                      startReps={lastOfSelected?.reps}
                      nextSetNumber={sets.filter((set) => set.movement.id === selectedMovement).length + 1}
                      timer={timer}
                    />
                  </div>
                )}
              </div>
            ),
          },
          {
            id: "list",
            label: "List",
            badge: (
              <span
                key={sets.length}
                className="num orbit-swap rounded-full bg-white/[0.08] px-2 py-0.5 text-[0.7rem] text-muted">
                {workout.plan ? `${plannedLogged}/${workout.plan.sets.length}` : sets.length}
              </span>
            ),
            content: (
              <div className="space-y-6">
                {recent.length > 0 && <RecentMovements recent={recent} selectedId={selected?.id} onPick={pickRecent} />}
                {workout.plan && workout.plan.sets.length > 0 && (
                  <PlannedSets
                    plan={workout.plan.sets}
                    source={
                      workout.plan.title ??
                      (workout.plan.completedAt
                        ? formatDate(workout.plan.completedAt, timeZone, shortDate)
                        : "an earlier workout")
                    }
                    logged={sets}
                    pending={addSetMutation.isPending}
                    colors={colors}
                    currentId={currentId}
                    onFocusMovement={(movement) => handleMovementChange(movement, { reveal: false })}
                    onAdjust={pickRecent}
                    onLog={logPlanned}
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
                    onRepeat={repeatSet}
                    repeatPending={addSetMutation.isPending}
                  />
                )}
              </div>
            ),
          },
        ]}
      />

      {choosing && (
        <MovementBrowser
          mode="single"
          onClose={() => {
            setChoosing(false);
            setExtending(false);
          }}
          onPick={(movement) => {
            handleMovementChange(
              { id: movement.id, name: movement.name, isBodyWeight: movement.isBodyWeight },
              // Added after the plan was done: the workout carries on.
              { resumes: extending },
            );
            if (extending) setEnded(false);
            setChoosing(false);
            setExtending(false);
          }}
        />
      )}

      {/* When the rest after a movement's last planned set runs out, the workout moves on to the next movement. */}
      <RestTimerPill timer={timer} onEnd={() => movesOn && nextGroup && goNext()} />
    </div>
  );
}
