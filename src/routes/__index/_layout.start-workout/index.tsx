import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Play, Timer } from "lucide-react";
import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { prefersReducedMotion, StartCountdown } from "@/components/start-countdown";
import { PageHeader } from "@/components/page-header";
import { MovementThumb } from "@/components/movement-figure/movement-thumb";
import { startWorkoutServerFn } from "@/lib/workouts.server";
import { formatDate, fullDate } from "@/lib/dates";
import { formatClock } from "@/lib/use-now";
import { weightUnit } from "@/lib/units";
import { currentWorkoutQueryOptions } from "../_layout.current-workout/-queries/current-workout";
import { presetsQueryKey, previewQueryOptions } from "../_layout.workout-library/-queries/presets";

type StartSearch = { preset: string | undefined; from: string | undefined };

export const Route = createFileRoute("/__index/_layout/start-workout/")({
  validateSearch: (search: Record<string, unknown>): StartSearch => ({
    preset: typeof search.preset === "string" ? search.preset : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
  }),
  loaderDeps: ({ search }) => ({ preset: search.preset ?? null, from: search.from ?? null }),
  loader: async ({ context, deps }) => {
    await context.queryClient.ensureQueryData(previewQueryOptions(deps.preset, deps.from));
  },
  component: StartWorkoutPage,
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Where a workout begins. Choosing a preset, the workout of the day or a past workout opens this screen, which shows
 * what the workout will be. The workout and its clock start only when Start is pressed, so looking costs nothing and
 * nothing is created by a tap on a card.
 */
function StartWorkoutPage() {
  const search = Route.useSearch();
  const { timeZone } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // 3, 2, 1, GO before the workout is created, so the clock starts at GO.
  const [counting, setCounting] = useState(false);
  const { data: preview } = useSuspenseQuery(previewQueryOptions(search.preset ?? null, search.from ?? null));

  const start = useMutation({
    mutationFn: async () => {
      const result = await startWorkoutServerFn({
        data: { presetId: search.preset ?? null, fromWorkoutId: search.from ?? null },
      });
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => navigate({ to: "/current-workout" }),
    // Also after a refusal: the page may not know yet that a workout is open.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: currentWorkoutQueryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: [...presetsQueryKey, "preview"] });
    },
  });

  if (!preview) {
    return (
      <div className="space-y-4 pt-6">
        <p className="text-lg font-semibold text-chalk">That workout doesn't exist.</p>
        <Link to="/workout-library" className="text-accent underline-offset-4 hover:underline">
          Back to your workouts
        </Link>
      </div>
    );
  }

  const totalSets = preview.exercises.reduce((sum, e) => sum + e.sets.length, 0);
  const subtitle =
    preview.kind === "repeat" && preview.subtitle ? `From ${formatDate(preview.subtitle, timeZone, fullDate)}` : null;

  return (
    // On a phone the page is at least a screen tall and the buttons sit at its bottom, in the thumb's reach above the dock.
    <div className="flex flex-col space-y-6 max-md:min-h-[calc(100dvh-9.5rem)]">
      <PageHeader
        title={preview.title}
        actions={
          preview.kind === "preset" && search.preset ? (
            <Link
              to="/workout-library/$presetId"
              params={{ presetId: search.preset }}
              className={buttonClasses({ variant: "outline" })}>
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          ) : undefined
        }
      />

      {preview.exercises.length === 0 ? (
        <p className="enter enter-1 text-muted">Add movements as you go.</p>
      ) : (
        <div className="enter enter-1 space-y-4">
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}

          <p className="num text-sm text-muted">
            {plural(preview.exercises.length, "movement")} · {plural(totalSets, "set")}
          </p>
          <ul className="space-y-3" aria-label="Movements in this workout">
            {preview.exercises.map((exercise) => (
              <li key={exercise.movement.id} className="rounded-2xl bg-well p-3" data-movement={exercise.movement.name}>
                <div className="flex items-center gap-3">
                  <MovementThumb
                    primary={exercise.movement.primaryMuscles}
                    secondary={exercise.movement.secondaryMuscles}
                    className="h-12 w-12 shrink-0 rounded-xl"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-chalk">{exercise.movement.name}</p>
                    <p className="num flex items-center gap-1.5 text-xs text-faint">
                      {plural(exercise.sets.length, "set")}
                      {exercise.restSeconds !== null && exercise.restSeconds > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <Timer className="h-3 w-3" aria-hidden="true" />
                          <span>{formatClock(exercise.restSeconds)} rest</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <ol className="mt-2 grid gap-1 pl-1 sm:grid-cols-2">
                  {exercise.sets.map((set, i) => (
                    <li key={i} className="num flex items-center gap-2 text-sm text-muted">
                      <span className="w-9 text-xs text-muted">Set {i + 1}</span>
                      <span className="font-semibold text-chalk">{set.reps}</span> reps
                      {set.weight !== null && (
                        <>
                          {" "}
                          × <span className="font-semibold text-chalk">{set.weight}</span> {weightUnit}
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </div>
      )}

      {counting && (
        <StartCountdown
          onCancel={() => setCounting(false)}
          onDone={() => {
            setCounting(false);
            start.mutate();
          }}
        />
      )}

      <div className="enter enter-2 -mx-4 mt-auto flex flex-col gap-3 bg-linear-to-t from-ground from-70% to-transparent px-4 pt-6 pb-1 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mb-24 max-md:pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.25rem))] sm:flex-row sm:items-center md:static md:mx-0 md:mt-0 md:bg-none md:p-0">
        {preview.hasActiveWorkout ? (
          <>
            <Button size="lg" disabled className="w-full sm:w-auto">
              <Play className="h-4 w-4 fill-current" />
              Start workout
            </Button>
            <p className="text-sm text-muted">
              You have a workout in progress.{" "}
              <Link to="/current-workout" className="text-accent underline-offset-4 hover:underline">
                Finish it
              </Link>{" "}
              before starting another.
            </p>
          </>
        ) : (
          <Button
            size="lg"
            onClick={() => (prefersReducedMotion() ? start.mutate() : setCounting(true))}
            disabled={start.isPending || counting}
            className="w-full sm:w-auto">
            <Play className="h-4 w-4 fill-current" />
            {start.isPending ? "Starting..." : "Start workout"}
          </Button>
        )}
        <Link
          to={
            preview.kind === "repeat"
              ? "/workout-history"
              : preview.kind === "empty"
                ? "/current-workout"
                : "/workout-library"
          }
          className={buttonClasses({ variant: "ghost", size: "lg", className: "w-full sm:w-auto" })}>
          <ArrowLeft className="h-4 w-4" />
          Not now
        </Link>
      </div>
    </div>
  );
}
