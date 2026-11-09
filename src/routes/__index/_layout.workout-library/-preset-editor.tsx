import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Copy, Plus, Play, Trash2, X } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { MovementBrowser } from "@/components/movement-browser";
import type { MovementCardData } from "@/components/movement-card";
import { MovementThumb } from "@/components/movement-figure/movement-thumb";
import { weekdayNames, weekdayShort } from "@/components/workout-card";
import { deletePresetServerFn, savePresetServerFn } from "@/lib/presets.server";
import { repsSchema, weightSchema } from "@/lib/validation";
import { defaultRestSeconds, maxExercisesPerPreset, maxSetsPerExercise, restSecondsSchema } from "@/lib/presets";
import { weightUnit } from "@/lib/units";
import { cn } from "@/lib/utils";
import { presetsQueryKey } from "./-queries/presets";

// Fields are text while they are typed, and numbers only when saved.
export type DraftSet = { key: string; reps: string; weight: string };
export type DraftExercise = { key: string; movement: MovementCardData; restSeconds: string; sets: DraftSet[] };
export type Draft = { name: string; exercises: DraftExercise[]; weekdays: number[] };

const restChoices = [30, 45, 60, 90, 120, 180] as const;
const defaultSetCount = 3;
const defaultReps = "10";

let counter = 0;
const nextKey = () => `k${++counter}`;

/** A movement added to a workout starts with three series of 10 and the default rest, all edited in place afterwards. */
export function newExercise(movement: MovementCardData, key = nextKey()): DraftExercise {
  return {
    key,
    movement,
    restSeconds: String(defaultRestSeconds),
    sets: Array.from({ length: defaultSetCount }, (_, i) => ({ key: `${key}-${i}`, reps: defaultReps, weight: "" })),
  };
}

/** What stops this draft from being saved, in the words of the form, or null when it is fine. */
export function draftProblem(draft: Draft): string | null {
  if (!draft.name.trim()) return "Give the workout a name";
  if (draft.exercises.length === 0) return "Add at least one movement";
  for (const exercise of draft.exercises) {
    const name = exercise.movement.name;
    if (!restSecondsSchema.safeParse(exercise.restSeconds === "" ? NaN : Number(exercise.restSeconds)).success) {
      return `${name}: rest must be 0 to 3600 seconds`;
    }
    for (const [i, set] of exercise.sets.entries()) {
      if (!repsSchema.safeParse(set.reps === "" ? NaN : Number(set.reps)).success) {
        return `${name}, set ${i + 1}: reps must be a whole number from 1 to 1000`;
      }
      if (set.weight !== "") {
        const result = weightSchema.safeParse(Number(set.weight));
        if (!result.success) return `${name}, set ${i + 1}: weight ${result.error.issues[0]?.message.toLowerCase()}`;
      }
    }
  }
  return null;
}

/**
 * Builds a workout for the library. Pick movements (several at once, from cards), then for each one set the rest and
 * edit its series right where they are: add a series, change the reps, remove one. A movement is added once, never once
 * per series. The weight of a series is optional, a value to help track progress. Everything on the page is saved
 * together, so what is on the screen is what the library has.
 */
export function PresetEditor({ presetId, initial }: { presetId: string | null; initial: Draft }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(initial);
  const [browsing, setBrowsing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const problem = draftProblem(draft);
  const patchExercise = (key: string, patch: Partial<DraftExercise>) =>
    setDraft((d) => ({ ...d, exercises: d.exercises.map((e) => (e.key === key ? { ...e, ...patch } : e)) }));
  const patchSet = (exerciseKey: string, setKey: string, patch: Partial<DraftSet>) =>
    setDraft((d) => ({
      ...d,
      exercises: d.exercises.map((e) =>
        e.key === exerciseKey ? { ...e, sets: e.sets.map((s) => (s.key === setKey ? { ...s, ...patch } : s)) } : e,
      ),
    }));
  const move = (index: number, by: -1 | 1) =>
    setDraft((d) => {
      const exercises = [...d.exercises];
      const target = index + by;
      if (target < 0 || target >= exercises.length) return d;
      [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
      return { ...d, exercises };
    });

  const save = useMutation({
    mutationFn: async () => {
      const result = await savePresetServerFn({
        data: {
          id: presetId,
          name: draft.name.trim(),
          weekdays: draft.weekdays,
          exercises: draft.exercises.map((e) => ({
            movementId: e.movement.id,
            restSeconds: Number(e.restSeconds),
            sets: e.sets.map((s) => ({ reps: Number(s.reps), weight: s.weight === "" ? null : Number(s.weight) })),
          })),
        },
      });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: presetsQueryKey });
      navigate({ to: "/workout-library" });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const result = await deletePresetServerFn({ data: { presetId: presetId! } });
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: presetsQueryKey });
      navigate({ to: "/workout-library" });
    },
  });

  const totalSets = draft.exercises.reduce((sum, e) => sum + e.sets.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        context={presetId ? "Edit workout" : "New workout"}
        title={draft.name.trim() || "Untitled workout"}
        actions={
          presetId ? (
            <Link
              to="/start-workout"
              search={{ preset: presetId, from: undefined }}
              className={buttonClasses({ variant: "outline" })}>
              <Play className="h-4 w-4" />
              Start
            </Link>
          ) : undefined
        }
      />

      <Card className="enter enter-1 space-y-2 p-4 sm:p-5">
        <label htmlFor="workout-name" className="text-sm text-muted">
          Name
        </label>
        <Input
          id="workout-name"
          aria-label="Workout name"
          value={draft.name}
          maxLength={60}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="Push day"
          className="h-14 text-lg"
          autoComplete="off"
        />
      </Card>

      <section className="space-y-3" aria-label="Movements in this workout">
        {draft.exercises.length === 0 && (
          <p className="glass rounded-panel px-6 py-10 text-center text-sm text-muted">
            No movements yet. Add the ones you do, and set the series for each.
          </p>
        )}
        {draft.exercises.map((exercise, index) => {
          const name = exercise.movement.name;
          return (
            <Card key={exercise.key} className="enter p-3 sm:p-4" data-exercise={name}>
              <div className="flex items-center gap-3">
                <MovementThumb
                  primary={exercise.movement.primaryMuscles}
                  secondary={exercise.movement.secondaryMuscles}
                  className="h-12 w-12 shrink-0 rounded-xl"
                />
                <h3 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-chalk font-stretch-[108%]">
                  {name}
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${name} down`}
                  disabled={index === draft.exercises.length - 1}
                  onClick={() => move(index, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${name}`}
                  className="hover:text-danger"
                  onClick={() =>
                    setDraft((d) => ({ ...d, exercises: d.exercises.filter((e) => e.key !== exercise.key) }))
                  }>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="text-sm text-muted" htmlFor={`rest-${exercise.key}`}>
                  Rest
                </label>
                <Input
                  id={`rest-${exercise.key}`}
                  type="number"
                  inputMode="numeric"
                  aria-label={`Rest after each set of ${name}, in seconds`}
                  min={0}
                  max={3600}
                  value={exercise.restSeconds}
                  onChange={(e) => patchExercise(exercise.key, { restSeconds: e.target.value })}
                  className="num h-10 w-24 text-center"
                />
                <span className="text-sm text-muted">seconds</span>
                <div className="flex flex-wrap gap-1" role="group" aria-label={`Rest choices for ${name}`}>
                  {restChoices.map((seconds) => (
                    <button
                      key={seconds}
                      type="button"
                      aria-pressed={exercise.restSeconds === String(seconds)}
                      onClick={() => patchExercise(exercise.key, { restSeconds: String(seconds) })}
                      className={cn(
                        "press num h-8 rounded-full border px-2.5 text-xs font-semibold",
                        exercise.restSeconds === String(seconds)
                          ? "border-primary/60 bg-primary/15 text-chalk"
                          : "border-line bg-white/[0.04] text-muted hover:text-chalk",
                      )}>
                      {seconds}s
                    </button>
                  ))}
                </div>
              </div>

              <ol className="mt-3 space-y-1.5" aria-label={`Sets of ${name}`}>
                {exercise.sets.map((set, i) => (
                  <li
                    key={set.key}
                    className="flex flex-wrap items-center gap-2 rounded-2xl bg-well py-1.5 pr-1.5 pl-3">
                    <span className="num w-11 shrink-0 text-xs font-semibold text-faint" aria-hidden="true">
                      SET {i + 1}
                    </span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      aria-label={`Reps of set ${i + 1} of ${name}`}
                      min={1}
                      max={1000}
                      value={set.reps}
                      onChange={(e) => patchSet(exercise.key, set.key, { reps: e.target.value })}
                      className="num h-10 w-20 text-center"
                    />
                    <span className="text-sm text-muted">reps</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      aria-label={`Weight of set ${i + 1} of ${name}, optional`}
                      placeholder={`${weightUnit} (optional)`}
                      min={0}
                      max={9999.99}
                      step="0.01"
                      value={set.weight}
                      onChange={(e) => patchSet(exercise.key, set.key, { weight: e.target.value })}
                      className="num h-10 w-36 text-center"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove set ${i + 1} of ${name}`}
                      disabled={exercise.sets.length === 1}
                      className="ml-auto h-10 w-10 hover:text-danger"
                      onClick={() =>
                        patchExercise(exercise.key, { sets: exercise.sets.filter((s) => s.key !== set.key) })
                      }>
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ol>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                disabled={exercise.sets.length >= maxSetsPerExercise}
                aria-label={`Add a set to ${name}`}
                onClick={() => {
                  // The new series starts as a copy of the last one, which is what most people want next.
                  const last = exercise.sets[exercise.sets.length - 1];
                  patchExercise(exercise.key, {
                    sets: [
                      ...exercise.sets,
                      { key: nextKey(), reps: last?.reps ?? defaultReps, weight: last?.weight ?? "" },
                    ],
                  });
                }}>
                <Copy className="h-4 w-4" />
                Add set
              </Button>
            </Card>
          );
        })}
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          disabled={draft.exercises.length >= maxExercisesPerPreset}
          onClick={() => setBrowsing(true)}>
          <Plus className="h-4 w-4" />
          Add movements
        </Button>
      </section>

      <Card className="enter space-y-3 p-4 sm:p-5">
        <div>
          <h2 className="text-base font-semibold text-chalk">Workout of the day</h2>
          <p className="mt-1 text-sm text-muted">Shows on Home on the days you pick.</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
          {weekdayShort.map((short, i) => {
            const day = i + 1;
            const on = draft.weekdays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                aria-label={weekdayNames[i]}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    weekdays: on ? d.weekdays.filter((x) => x !== day) : [...d.weekdays, day].sort(),
                  }))
                }
                className={cn(
                  "press h-11 min-w-12 rounded-full border px-3 text-sm font-semibold",
                  on
                    ? "border-primary/60 bg-primary/15 text-chalk"
                    : "border-line bg-white/[0.04] text-muted hover:text-chalk",
                )}>
                {short}
              </button>
            );
          })}
        </div>
      </Card>

      <div className="enter flex flex-col gap-3 pb-4 sm:flex-row sm:items-center">
        <Button
          size="lg"
          disabled={!!problem || save.isPending}
          onClick={() => save.mutate()}
          className="w-full sm:w-auto">
          {save.isPending ? "Saving..." : "Save workout"}
        </Button>
        <Link
          to="/workout-library"
          className={buttonClasses({ variant: "ghost", size: "lg", className: "w-full sm:w-auto" })}>
          Cancel
        </Link>
        {presetId &&
          (confirmDelete ? (
            <div className="flex items-center gap-2 sm:ml-auto">
              <span className="text-sm text-muted">Delete this workout?</span>
              <Button variant="destructive" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
                Yes, delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <Button
              variant="destructive"
              size="lg"
              className="w-full sm:ml-auto sm:w-auto"
              onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          ))}
      </div>
      <p className="num -mt-3 min-h-5 px-1 text-xs text-faint" aria-live="polite">
        {problem ??
          `${draft.exercises.length} ${draft.exercises.length === 1 ? "movement" : "movements"} · ${totalSets} sets`}
      </p>

      {browsing && (
        <MovementBrowser
          onClose={() => setBrowsing(false)}
          onAdd={(movements) => {
            setDraft((d) => ({
              ...d,
              exercises: [
                ...d.exercises,
                ...movements.slice(0, maxExercisesPerPreset - d.exercises.length).map((m) => newExercise(m)),
              ],
            }));
            setBrowsing(false);
          }}
        />
      )}
    </div>
  );
}
