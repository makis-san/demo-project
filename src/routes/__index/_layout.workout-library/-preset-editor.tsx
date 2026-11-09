import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ChevronsDown, ChevronsUp, Pencil, Plus, Play, Trash2 } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { MovementBrowser } from "@/components/movement-browser";
import { MovementDetailSheet } from "@/components/movement-detail";
import type { MovementCardData } from "@/components/movement-card";
import { MovementThumb } from "@/components/movement-figure/movement-thumb";
import { weekdayNames, weekdayShort } from "@/components/workout-card";
import { deletePresetServerFn, savePresetServerFn } from "@/lib/presets.server";
import { repsSchema, weightSchema } from "@/lib/validation";
import { defaultRestSeconds, maxExercisesPerPreset, restSecondsSchema } from "@/lib/presets";
import { weightUnit } from "@/lib/units";
import { cn } from "@/lib/utils";
import { presetsQueryKey } from "./-queries/presets";
import { applyBulk, ExerciseCard, MovementRow, QuickBulk, SelectionBar, type BulkPatch } from "./-exercise-editor";

// Fields are text while they are typed, and numbers only when saved.
export type DraftSet = { key: string; reps: string; weight: string };
export type DraftExercise = { key: string; movement: MovementCardData; restSeconds: string; sets: DraftSet[] };
export type Draft = { name: string; exercises: DraftExercise[]; weekdays: number[] };

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

/** What is wrong with the movements and their series, in the words of the form, or null when they are fine. */
function exercisesProblem(exercises: DraftExercise[]): string | null {
  if (exercises.length === 0) return "Add at least one movement";
  for (const exercise of exercises) {
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

/** What stops this draft from being saved, in the words of the form, or null when it is fine. */
export function draftProblem(draft: Draft): string | null {
  if (!draft.name.trim()) return "Give the workout a name";
  return exercisesProblem(draft.exercises);
}

/** "3 × 10", or "10, 8, 6" when the series differ, and the weight when every series has the same one. */
function setsSummary(exercise: DraftExercise) {
  const reps = exercise.sets.map((s) => s.reps);
  const same = reps.every((r) => r === reps[0]);
  const weights = exercise.sets.map((s) => s.weight);
  const weight = weights[0] !== "" && weights.every((w) => w === weights[0]) ? ` @ ${weights[0]} ${weightUnit}` : "";
  return `${same ? `${reps.length} × ${reps[0]}` : reps.join(", ")}${weight}`;
}

/** A rough length for the workout: about 40 seconds a series, the rest after each, and a minute to set up a movement. */
function estimatedMinutes(exercises: DraftExercise[]) {
  const seconds = exercises.reduce((sum, e) => sum + 60 + e.sets.length * (40 + (Number(e.restSeconds) || 0)), 0);
  return Math.max(1, Math.round(seconds / 60));
}

const steps = [
  { title: "Movements", hint: "Pick and order them" },
  { title: "Sets & rest", hint: "Series for each" },
  { title: "Name & save", hint: "And when you do it" },
] as const;

/**
 * Builds a workout for the library. A new workout is three steps: pick the movements and put them in order, set the
 * series and the rest of each one, then name it and choose its days. Editing a saved workout shows the same parts on
 * one page, since it is a change to something already there and not a build from nothing.
 *
 * Both have **bulk actions**: tick movements (or none, for all of them) and set their series, reps, weight or rest
 * together, or remove or reorder the ticked ones. Every bulk change can be undone. A movement is added once, never
 * once per series. Everything is saved together, so what is on the screen is what the library has.
 */
export function PresetEditor({ presetId, initial }: { presetId: string | null; initial: Draft }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const wizard = presetId === null;
  const [draft, setDraft] = useState<Draft>(initial);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [browsing, setBrowsing] = useState(false);
  const [detail, setDetail] = useState<MovementCardData | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ text: string; before: Draft } | null>(null);
  const [flashed, setFlashed] = useState<Set<string>>(new Set());

  // A notice with an undo stays for a few seconds, and a flash on the changed cards for one animation.
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    if (flashed.size === 0) return;
    const id = window.setTimeout(() => setFlashed(new Set()), 900);
    return () => window.clearTimeout(id);
  }, [flashed]);

  const problem = draftProblem(draft);
  const stepProblems = [
    draft.exercises.length === 0 ? "Add at least one movement" : null,
    exercisesProblem(draft.exercises),
    problem,
  ];
  const reachable = (i: number) => stepProblems.slice(0, i).every((p) => p === null);

  const go = (to: number) => {
    if (to === step || !reachable(to)) return;
    setDirection(to > step ? "next" : "prev");
    setStep(to);
    setSelected(new Set());
    window.scrollTo({ top: 0 });
  };

  /** A change that can be undone: the draft before it is kept with the notice. */
  const commit = (text: string, change: (d: Draft) => Draft, flash?: Iterable<string>) => {
    setNotice({ text, before: draft });
    setDraft(change(draft));
    if (flash) setFlashed(new Set(flash));
  };

  const patchExercise = (key: string, patch: Partial<DraftExercise>) =>
    setDraft((d) => ({ ...d, exercises: d.exercises.map((e) => (e.key === key ? { ...e, ...patch } : e)) }));
  const patchSet = (exerciseKey: string, setKey: string, patch: Partial<DraftSet>) =>
    setDraft((d) => ({
      ...d,
      exercises: d.exercises.map((e) =>
        e.key === exerciseKey ? { ...e, sets: e.sets.map((s) => (s.key === setKey ? { ...s, ...patch } : s)) } : e,
      ),
    }));
  const addSet = (exercise: DraftExercise) => {
    // The new series starts as a copy of the last one, which is what most people want next.
    const last = exercise.sets[exercise.sets.length - 1];
    patchExercise(exercise.key, {
      sets: [...exercise.sets, { key: nextKey(), reps: last?.reps ?? defaultReps, weight: last?.weight ?? "" }],
    });
  };
  const move = (index: number, by: -1 | 1) =>
    setDraft((d) => {
      const exercises = [...d.exercises];
      const target = index + by;
      if (target < 0 || target >= exercises.length) return d;
      [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
      return { ...d, exercises };
    });
  const removeOne = (key: string) => {
    setDraft((d) => ({ ...d, exercises: d.exercises.filter((e) => e.key !== key) }));
    setSelected((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  };
  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const plural = (n: number) => `${n} ${n === 1 ? "movement" : "movements"}`;

  const bulkRemove = () => {
    const n = selected.size;
    commit(`Removed ${plural(n)}`, (d) => ({ ...d, exercises: d.exercises.filter((e) => !selected.has(e.key)) }));
    setSelected(new Set());
  };
  const bulkMove = (to: "top" | "bottom") => {
    const n = selected.size;
    commit(
      `Moved ${plural(n)} to the ${to}`,
      (d) => {
        const picked = d.exercises.filter((e) => selected.has(e.key));
        const rest = d.exercises.filter((e) => !selected.has(e.key));
        return { ...d, exercises: to === "top" ? [...picked, ...rest] : [...rest, ...picked] };
      },
      selected,
    );
  };
  const bulkApply = (patch: BulkPatch) => {
    const targets = selected.size > 0 ? selected : new Set(draft.exercises.map((e) => e.key));
    commit(
      `Updated ${plural(targets.size)}`,
      (d) => ({
        ...d,
        exercises: d.exercises.map((e) => (targets.has(e.key) ? applyBulk(e, patch, nextKey) : e)),
      }),
      targets,
    );
  };

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
  const full = draft.exercises.length >= maxExercisesPerPreset;
  const summary = `${plural(draft.exercises.length)} · ${totalSets} sets`;

  /* ---------------------------------------------------------------------------------------------------------- */
  /* The parts, shared by the steps of a new workout and the one page of an edit. */

  const nameField = (
    <Card className="enter space-y-2 p-4 sm:p-5">
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
        autoFocus={wizard}
      />
    </Card>
  );

  const weekdaysField = (
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
  );

  const addButton = (
    <Button variant="outline" size="lg" className="w-full" disabled={full} onClick={() => setBrowsing(true)}>
      <Plus className="h-4 w-4" />
      {full ? `${maxExercisesPerPreset} movements is the most` : "Add movements"}
    </Button>
  );

  const selectionActions = (
    <>
      <Button variant="ghost" size="sm" onClick={() => bulkMove("top")}>
        <ChevronsUp className="h-4 w-4" />
        To top
      </Button>
      <Button variant="ghost" size="sm" onClick={() => bulkMove("bottom")}>
        <ChevronsDown className="h-4 w-4" />
        To bottom
      </Button>
      <Button variant="destructive" size="sm" onClick={bulkRemove}>
        <Trash2 className="h-4 w-4" />
        Remove {selected.size}
      </Button>
    </>
  );

  const selectionBar = (actions: React.ReactNode) =>
    draft.exercises.length > 1 && (
      <SelectionBar
        total={draft.exercises.length}
        count={selected.size}
        onAll={() => setSelected(new Set(draft.exercises.map((e) => e.key)))}
        onNone={() => setSelected(new Set())}>
        {actions}
      </SelectionBar>
    );

  const exerciseCards = (arrange: boolean) => (
    <>
      {/* Ticking and bulk changes only mean something with two movements or more. */}
      {draft.exercises.length > 1 && (
        <QuickBulk
          total={draft.exercises.length}
          count={selected.size}
          onAll={() => setSelected(new Set(draft.exercises.map((e) => e.key)))}
          onNone={() => setSelected(new Set())}
          onApply={bulkApply}
          extra={
            arrange && (
              <Button variant="destructive" size="sm" onClick={bulkRemove}>
                <Trash2 className="h-4 w-4" />
                Remove {selected.size}
              </Button>
            )
          }
        />
      )}
      {draft.exercises.map((exercise, index) => (
        <ExerciseCard
          key={exercise.key}
          exercise={exercise}
          index={index}
          count={draft.exercises.length}
          selected={selected.has(exercise.key)}
          onToggle={draft.exercises.length > 1 ? () => toggle(exercise.key) : undefined}
          arrange={arrange}
          flash={flashed.has(exercise.key)}
          onApply={(patch) => patchExercise(exercise.key, applyBulk(exercise, patch, nextKey))}
          onPatch={(patch) => patchExercise(exercise.key, patch)}
          onPatchSet={(setKey, patch) => patchSet(exercise.key, setKey, patch)}
          onAddSet={() => addSet(exercise)}
          onMove={(by) => move(index, by)}
          onRemove={() => removeOne(exercise.key)}
        />
      ))}
    </>
  );

  const emptyMovements = (
    <p className="glass rounded-panel px-6 py-10 text-center text-sm text-muted">
      No movements yet. Add the ones you do, and set the series for each.
    </p>
  );

  const noticeBar = notice && (
    <div
      role="status"
      className="enter fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full border border-line-strong bg-raised/95 py-1.5 pr-1.5 pl-5 text-sm text-chalk shadow-2xl backdrop-blur sm:bottom-6">
      <span className="num">{notice.text}</span>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setDraft(notice.before);
          setNotice(null);
          setSelected(new Set());
        }}>
        Undo
      </Button>
    </div>
  );

  const sheets = (
    <>
      {browsing && (
        <MovementBrowser
          onClose={() => setBrowsing(false)}
          onAdd={(movements) => {
            // A movement already in the workout is not added a second time.
            const have = new Set(draft.exercises.map((e) => e.movement.id));
            const added = movements
              .filter((m) => !have.has(m.id))
              .slice(0, maxExercisesPerPreset - draft.exercises.length)
              .map((m) => newExercise(m));
            setDraft((d) => ({ ...d, exercises: [...d.exercises, ...added] }));
            setFlashed(new Set(added.map((e) => e.key)));
            setBrowsing(false);
          }}
        />
      )}
      {detail && <MovementDetailSheet movement={detail} onClose={() => setDetail(null)} />}
    </>
  );

  /* ---------------------------------------------------------------------------------------------------------- */

  if (!wizard) {
    return (
      <div className="space-y-6">
        <PageHeader
          context="Edit workout"
          title={draft.name.trim() || "Untitled workout"}
          actions={
            <Link
              to="/start-workout"
              search={{ preset: presetId, from: undefined }}
              className={buttonClasses({ variant: "outline" })}>
              <Play className="h-4 w-4" />
              Start
            </Link>
          }
        />
        {nameField}
        <section className="space-y-3" aria-label="Movements in this workout">
          {draft.exercises.length === 0 && emptyMovements}
          {exerciseCards(true)}
          {addButton}
        </section>
        {weekdaysField}

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
          {confirmDelete ? (
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
          )}
        </div>
        <p className="num -mt-3 min-h-5 px-1 text-xs text-faint" aria-live="polite">
          {problem ?? summary}
        </p>
        {noticeBar}
        {sheets}
      </div>
    );
  }

  /* A new workout: one step at a time. */

  const last = step === steps.length - 1;
  const stepProblem = stepProblems[step];

  return (
    <div className="space-y-6">
      <PageHeader
        context={`New workout · Step ${step + 1} of ${steps.length}`}
        title={draft.name.trim() || "Untitled workout"}
      />

      <nav aria-label="Steps" className="enter enter-1">
        <ol className="flex gap-2 sm:grid sm:grid-cols-3">
          {steps.map((s, i) => {
            const done = i < step && stepProblems[i] === null;
            const current = i === step;
            const open = reachable(i);
            return (
              <li key={s.title} className={cn("min-w-0 sm:flex-none", current ? "flex-1" : "shrink-0")}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  disabled={!open && !current}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "press group w-full rounded-2xl border p-2.5 text-left sm:p-3",
                    current
                      ? "border-primary/60 bg-primary/10"
                      : "border-line bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-50",
                  )}>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "num grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors",
                        current ? "bg-primary text-primary-ink" : done ? "bg-ok/20 text-ok" : "bg-well text-faint",
                      )}>
                      {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 truncate text-sm font-semibold text-chalk",
                        !current && "sr-only sm:not-sr-only",
                      )}>
                      {s.title}
                    </span>
                  </span>
                  <span className="mt-1 hidden truncate pl-8 text-xs text-faint sm:block">{s.hint}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {/* How far along: a bar that fills as the steps go by. */}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-well" aria-hidden="true">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-[var(--ease-enter)]"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>
      </nav>

      <div key={step} className={direction === "next" ? "step-next" : "step-prev"}>
        {step === 0 && (
          <section className="space-y-3" aria-label="Movements in this workout">
            {draft.exercises.length === 0 ? (
              <>
                {emptyMovements}
                {addButton}
              </>
            ) : (
              <>
                {selectionBar(selectionActions)}
                <ol className="space-y-1.5">
                  {draft.exercises.map((exercise, index) => (
                    <MovementRow
                      key={exercise.key}
                      exercise={exercise}
                      index={index}
                      count={draft.exercises.length}
                      selected={selected.has(exercise.key)}
                      onToggle={() => toggle(exercise.key)}
                      onMove={(by) => move(index, by)}
                      onRemove={() => removeOne(exercise.key)}
                      onInfo={() => setDetail(exercise.movement)}
                    />
                  ))}
                </ol>
                {addButton}
              </>
            )}
          </section>
        )}

        {step === 1 && (
          <section className="space-y-3" aria-label="Sets and rest">
            {exerciseCards(false)}
          </section>
        )}

        {step === 2 && (
          <div className="space-y-6">
            {nameField}
            {weekdaysField}
            <Card className="enter space-y-3 p-4 sm:p-5" aria-label="Review">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-chalk">Review</h2>
                <p className="num text-xs text-muted">
                  {summary} · about {estimatedMinutes(draft.exercises)} min
                </p>
              </div>
              <ol className="divide-y divide-line">
                {draft.exercises.map((exercise, index) => (
                  <li key={exercise.key} className="flex items-center gap-3 py-2">
                    <span className="num w-5 shrink-0 text-center text-xs font-semibold text-faint">{index + 1}</span>
                    <MovementThumb
                      primary={exercise.movement.primaryMuscles}
                      secondary={exercise.movement.secondaryMuscles}
                      className="h-10 w-10 shrink-0 rounded-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-chalk">{exercise.movement.name}</p>
                      <p className="num truncate text-xs text-faint">
                        {setsSummary(exercise)} · {exercise.restSeconds}s rest
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              <Button variant="ghost" size="sm" onClick={() => go(1)}>
                <Pencil className="h-4 w-4" />
                Change sets
              </Button>
            </Card>
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 pb-4 sm:flex-row sm:items-center">
        {step === 0 ? (
          <Link
            to="/workout-library"
            className={buttonClasses({ variant: "ghost", size: "lg", className: "w-full sm:w-auto" })}>
            Cancel
          </Link>
        ) : (
          <Button variant="ghost" size="lg" className="w-full sm:w-auto" onClick={() => go(step - 1)}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}
        <div className="sm:ml-auto">
          {last ? (
            <Button
              size="lg"
              disabled={!!problem || save.isPending}
              onClick={() => save.mutate()}
              className="w-full sm:w-auto">
              {save.isPending ? "Saving..." : "Save workout"}
            </Button>
          ) : (
            <Button size="lg" disabled={!!stepProblem} onClick={() => go(step + 1)} className="w-full sm:w-auto">
              Next: {steps[step + 1].title}
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <p className="num -mt-3 min-h-5 px-1 text-xs text-faint sm:text-right" aria-live="polite">
        {stepProblem ?? summary}
      </p>
      {noticeBar}
      {sheets}
    </div>
  );
}
