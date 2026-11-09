import { useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { movementSubtitle } from "@/components/movement-card";
import { MovementThumb } from "@/components/movement-figure/movement-thumb";
import { StepButton, stepValue } from "@/components/stepper";
import { maxSetsPerExercise } from "@/lib/presets";
import { weightUnit } from "@/lib/units";
import { cn } from "@/lib/utils";
import type { DraftExercise, DraftSet } from "./-preset-editor";

/** What a bulk edit changes. A field left out is left alone on every movement. */
export type BulkPatch = { sets?: number; reps?: string; weight?: string; restSeconds?: string };

/** The common shapes, one tap to set the series and reps of the ticked movements (or all of them). */
const schemes = [
  { sets: 3, reps: 10 },
  { sets: 4, reps: 8 },
  { sets: 5, reps: 5 },
  { sets: 3, reps: 12 },
  { sets: 4, reps: 15 },
] as const;

/** The rests offered in the dropdown. A saved rest that is not one of them is added to the list, so it still shows. */
const restOptions = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300] as const;

/** "No rest", "45s", "1 min", "1:30". */
export function restLabel(seconds: number) {
  if (seconds === 0) return "No rest";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Applies a bulk edit to one movement. A new set count keeps the series already there and adds copies of the last one,
 * or drops series from the end. Reps and weight, when given, then go on every series.
 */
export function applyBulk(exercise: DraftExercise, patch: BulkPatch, nextKey: () => string): DraftExercise {
  let sets = exercise.sets;
  if (patch.sets !== undefined) {
    const last = sets[sets.length - 1];
    sets =
      patch.sets <= sets.length
        ? sets.slice(0, patch.sets)
        : [
            ...sets,
            ...Array.from(
              { length: patch.sets - sets.length },
              (): DraftSet => ({ key: nextKey(), reps: last?.reps ?? "10", weight: last?.weight ?? "" }),
            ),
          ];
  }
  if (patch.reps !== undefined) sets = sets.map((s) => ({ ...s, reps: patch.reps! }));
  if (patch.weight !== undefined) sets = sets.map((s) => ({ ...s, weight: patch.weight! }));
  return { ...exercise, sets, restSeconds: patch.restSeconds ?? exercise.restSeconds };
}

/** The one value every series shares, or null when they differ. */
const shared = (values: string[]) => (values.every((v) => v === values[0]) ? (values[0] ?? "") : null);

/** A round checkbox, the same one the movement cards use. */
export function SelectBox({
  checked,
  mixed,
  label,
  onChange,
  className,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  onChange: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "press grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors",
        checked || mixed
          ? "border-primary bg-primary text-primary-ink"
          : "border-line-strong bg-black/20 text-transparent hover:text-faint",
        className,
      )}>
      {mixed ? <Minus className="h-4 w-4" /> : <Check className="h-4 w-4" />}
    </button>
  );
}

/**
 * The bar over a list that can be selected: tick all or none, the count, and the actions for the selection. The
 * actions only show once something is ticked, so the bar is quiet until it is used.
 */
export function SelectionBar({
  total,
  count,
  onAll,
  onNone,
  children,
}: {
  total: number;
  count: number;
  onAll: () => void;
  onNone: () => void;
  children?: React.ReactNode;
}) {
  const all = total > 0 && count === total;
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-2 px-1" role="toolbar" aria-label="Selection">
      <SelectBox
        checked={all}
        mixed={count > 0 && !all}
        label={all ? "Clear the selection" : "Select all movements"}
        onChange={all || count > 0 ? onNone : onAll}
      />
      <span className="num text-sm text-muted" aria-live="polite">
        {count === 0 ? "Select all" : `${count} of ${total} selected`}
      </span>
      {count > 0 && <div className="enter ml-auto flex flex-wrap items-center gap-1.5">{children}</div>}
    </div>
  );
}

/**
 * The bar over the sets step. Until a movement is ticked it only offers to tick them, so a tap never changes movements
 * the user did not choose. With some ticked, one tap gives all of them a set-and-rep scheme or a rest, at once, and the
 * editor offers an undo.
 */
export function QuickBulk({
  total,
  count,
  onAll,
  onNone,
  onApply,
  extra,
}: {
  total: number;
  count: number;
  onAll: () => void;
  onNone: () => void;
  onApply: (patch: BulkPatch) => void;
  /** More actions for the ticked movements, like removing them. */
  extra?: React.ReactNode;
}) {
  const all = total > 0 && count === total;
  return (
    <div
      role="toolbar"
      aria-label="Edit several movements at once"
      className="glass sticky top-2 z-20 flex min-h-[3.25rem] flex-wrap items-center gap-2 rounded-[1.25rem] p-2 pl-2.5">
      <SelectBox
        checked={all}
        mixed={count > 0 && !all}
        label={all ? "Clear the selection" : "Select all movements"}
        onChange={all || count > 0 ? onNone : onAll}
      />
      {count === 0 ? (
        <span className="text-sm text-muted">Select movements to change them together</span>
      ) : (
        <>
          <span className="num text-sm font-semibold text-chalk" aria-live="polite">
            {count} selected
          </span>
          <div
            className="enter flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            role="group"
            aria-label="Set and rep schemes">
            {schemes.map((s) => (
              <button
                key={`${s.sets}x${s.reps}`}
                type="button"
                onClick={() => onApply({ sets: s.sets, reps: String(s.reps) })}
                className="press num h-9 shrink-0 rounded-full border border-line bg-white/[0.04] px-3 text-xs font-semibold text-muted hover:border-line-strong hover:text-chalk">
                {s.sets} × {s.reps}
              </button>
            ))}
          </div>
          <RestMenu
            label="Rest for the selected movements"
            value={null}
            placeholder="Rest"
            onPick={(seconds) => onApply({ restSeconds: String(seconds) })}
            align="end"
            className="h-9 rounded-full bg-white/[0.04] px-3 text-xs"
          />
          {extra}
        </>
      )}
    </div>
  );
}

/**
 * The rest picker: a button that shows the rest and opens the menu of choices, the app's own menu rather than the
 * browser's. A rest saved before that is not one of the choices is listed too, so it still shows as picked.
 */
export function RestMenu({
  label,
  value,
  placeholder = "Rest",
  onPick,
  align = "start",
  className,
  onOpenChange,
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  onPick: (seconds: number) => void;
  align?: "start" | "end";
  className?: string;
  /** The card around the menu lifts itself over the next card while the menu is open, or the next card covers it. */
  onOpenChange?: (open: boolean) => void;
}) {
  const choices: number[] =
    value === null || !Number.isFinite(value) || restOptions.includes(value as (typeof restOptions)[number])
      ? [...restOptions]
      : [...restOptions, value].sort((a, b) => a - b);
  return (
    <div className="relative shrink-0">
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          aria-label={label}
          className={cn(
            "press num inline-flex w-full items-center justify-between gap-1.5 border border-line font-semibold text-chalk hover:border-line-strong aria-expanded:border-primary/70",
            className,
          )}>
          <span className={cn("truncate", value === null && "text-muted")}>
            {value === null || !Number.isFinite(value) ? placeholder : restLabel(value)}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          aria-label={label}
          sideOffset={6}
          className="max-h-72 w-full min-w-36 overflow-y-auto p-1.5">
          {choices.map((seconds) => {
            const on = seconds === value;
            return (
              <DropdownMenuItem
                key={seconds}
                role="menuitemradio"
                aria-checked={on}
                onClick={() => onPick(seconds)}
                className={cn(
                  "num justify-between rounded-xl px-3 py-2 font-medium",
                  on ? "bg-primary/15 text-chalk" : "text-muted hover:text-chalk",
                )}>
                {restLabel(seconds)}
                {on && <Check className="h-4 w-4 text-accent" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** One movement in the first step of a new workout: what it is, its place in the order, and a checkbox. */
export function MovementRow({
  exercise,
  index,
  count,
  selected,
  onToggle,
  onMove,
  onRemove,
  onInfo,
}: {
  exercise: DraftExercise;
  index: number;
  count: number;
  selected: boolean;
  onToggle: () => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onInfo?: () => void;
}) {
  const { movement } = exercise;
  return (
    <li
      data-exercise={movement.name}
      data-selected={selected}
      className={cn(
        "enter flex min-h-[4.5rem] items-center gap-3 rounded-2xl border bg-well p-2 pr-2 transition-colors",
        selected ? "border-primary/60 bg-primary/10" : "border-transparent",
      )}>
      <SelectBox checked={selected} label={`Select ${movement.name}`} onChange={onToggle} className="ml-1" />
      <span className="num w-5 shrink-0 text-center text-xs font-semibold text-faint" aria-hidden="true">
        {index + 1}
      </span>
      <MovementThumb
        primary={movement.primaryMuscles}
        secondary={movement.secondaryMuscles}
        className="h-12 w-12 shrink-0 rounded-xl"
      />
      <div className="min-w-0 flex-1">
        {onInfo ? (
          <button
            type="button"
            onClick={onInfo}
            className="block max-w-full truncate text-left text-[15px] font-medium text-chalk underline-offset-4 hover:underline">
            {movement.name}
          </button>
        ) : (
          <p className="truncate text-[15px] font-medium text-chalk">{movement.name}</p>
        )}
        <p className="truncate text-xs text-faint">{movementSubtitle(movement)}</p>
      </div>
      <ArrangeButtons name={movement.name} index={index} count={count} onMove={onMove} onRemove={onRemove} />
    </li>
  );
}

function ArrangeButtons({
  name,
  index,
  count,
  onMove,
  onRemove,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex shrink-0">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Move ${name} up`}
        disabled={index === 0}
        onClick={() => onMove(-1)}>
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Move ${name} down`}
        disabled={index === count - 1}
        onClick={() => onMove(1)}>
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remove ${name}`}
        className="hover:text-danger"
        onClick={onRemove}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

const fieldInput =
  "num no-spin h-10 w-full min-w-0 rounded-xl border border-line bg-black/25 px-2 text-center text-[15px] font-semibold text-chalk placeholder:text-faint placeholder:font-normal focus:border-primary/70 focus:outline-none";

/** − value +, holding a button keeps stepping. */
function Counter({
  label,
  value,
  placeholder,
  onChange,
  onStep,
  min,
  max,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onStep: (by: -1 | 1) => void;
  min: number;
  max: number;
}) {
  const n = Number(value);
  return (
    <div className="flex items-center gap-1">
      <StepButton direction="down" onStep={() => onStep(-1)} disabled={value !== "" && n <= min} className="h-10 w-10">
        Fewer
      </StepButton>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={fieldInput}
      />
      <StepButton direction="up" onStep={() => onStep(1)} disabled={value !== "" && n >= max} className="h-10 w-10">
        More
      </StepButton>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <p className="px-1 text-xs font-medium text-faint">{label}</p>
      {children}
    </div>
  );
}

/**
 * One movement and its plan, in one row of controls: how many sets, the reps and the weight of every set, and the
 * rest. That is how most workouts are written ("4 × 8 at 135, 90 seconds"). A pyramid or a drop set is one tap away
 * under "Edit each set", which opens by itself when the sets already differ.
 */
export function ExerciseCard({
  exercise,
  index,
  count,
  selected,
  onToggle,
  arrange,
  flash,
  onApply,
  onPatch,
  onPatchSet,
  onAddSet,
  onMove,
  onRemove,
}: {
  exercise: DraftExercise;
  index: number;
  count: number;
  selected?: boolean;
  onToggle?: () => void;
  arrange: boolean;
  flash?: boolean;
  onApply: (patch: BulkPatch) => void;
  onPatch: (patch: Partial<DraftExercise>) => void;
  onPatchSet: (setKey: string, patch: Partial<DraftSet>) => void;
  onAddSet: () => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const name = exercise.movement.name;
  const reps = shared(exercise.sets.map((s) => s.reps));
  const weight = shared(exercise.sets.map((s) => s.weight));
  const uniform = reps !== null && weight !== null;
  const [open, setOpen] = useState(!uniform);
  const [menuOpen, setMenuOpen] = useState(false);
  const rest = Number(exercise.restSeconds);

  return (
    <Card
      className={cn(
        "enter relative p-3 transition-[box-shadow,background-color] sm:p-4",
        // Each card is its own layer (glass blur, the entry animation), so the one with an open menu goes on top.
        menuOpen && "z-30",
        selected && "shadow-[inset_0_0_0_1px_oklch(58%_0.215_27/0.6)]",
        flash && "flash",
      )}
      data-exercise={name}
      data-selected={onToggle ? !!selected : undefined}>
      <div className="flex items-center gap-3">
        {onToggle && <SelectBox checked={!!selected} label={`Select ${name}`} onChange={onToggle} />}
        <MovementThumb
          primary={exercise.movement.primaryMuscles}
          secondary={exercise.movement.secondaryMuscles}
          className="h-10 w-10 shrink-0 rounded-lg"
        />
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-chalk font-stretch-[108%]">
          {name}
        </h3>
        {arrange && <ArrangeButtons name={name} index={index} count={count} onMove={onMove} onRemove={onRemove} />}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-[1fr_1fr_0.8fr_0.8fr]">
        <Field label="Sets">
          <Counter
            label={`Sets of ${name}`}
            value={String(exercise.sets.length)}
            min={1}
            max={maxSetsPerExercise}
            onChange={(v) => {
              const n = Math.round(Number(v));
              if (v !== "" && n >= 1 && n <= maxSetsPerExercise) onApply({ sets: n });
            }}
            onStep={(by) => {
              const n = exercise.sets.length + by;
              if (n >= 1 && n <= maxSetsPerExercise) onApply({ sets: n });
            }}
          />
        </Field>
        <Field label="Reps">
          <Counter
            label={`Reps of every set of ${name}`}
            value={reps ?? ""}
            placeholder={reps === null ? "Mixed" : undefined}
            min={1}
            max={1000}
            onChange={(v) => onApply({ reps: v })}
            onStep={(by) => onApply({ reps: stepValue(reps ?? exercise.sets[0]?.reps ?? "10", by, { min: 1 }) })}
          />
        </Field>
        <Field label={`Weight, ${weightUnit}`}>
          <input
            type="number"
            inputMode="decimal"
            aria-label={`Weight of every set of ${name}, optional`}
            min={0}
            max={9999.99}
            step="0.01"
            value={weight ?? ""}
            placeholder={weight === null ? "Mixed" : "Optional"}
            onChange={(e) => onApply({ weight: e.target.value })}
            className={fieldInput}
          />
        </Field>
        <Field label="Rest">
          <RestMenu
            label={`Rest after each set of ${name}`}
            value={rest}
            onPick={(seconds) => onPatch({ restSeconds: String(seconds) })}
            onOpenChange={setMenuOpen}
            className="h-10 rounded-xl bg-black/25 px-3 text-[15px]"
          />
        </Field>
      </div>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="press mt-2 inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-muted hover:text-chalk">
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        Edit each set
        {!uniform && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-accent">Sets differ</span>
        )}
      </button>

      {open && (
        <div className="enter mt-1 space-y-1">
          <ol className="space-y-1" aria-label={`Sets of ${name}`}>
            {exercise.sets.map((set, i) => (
              <li key={set.key} className="grid grid-cols-[2rem_1fr_auto_1fr_2.5rem] items-center gap-2">
                <span className="num text-center text-xs font-semibold text-faint" aria-hidden="true">
                  {i + 1}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label={`Reps of set ${i + 1} of ${name}`}
                  min={1}
                  max={1000}
                  value={set.reps}
                  onChange={(e) => onPatchSet(set.key, { reps: e.target.value })}
                  className={fieldInput}
                />
                <span className="text-xs text-faint" aria-hidden="true">
                  ×
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  aria-label={`Weight of set ${i + 1} of ${name}, optional`}
                  placeholder={weightUnit}
                  min={0}
                  max={9999.99}
                  step="0.01"
                  value={set.weight}
                  onChange={(e) => onPatchSet(set.key, { weight: e.target.value })}
                  className={fieldInput}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove set ${i + 1} of ${name}`}
                  disabled={exercise.sets.length === 1}
                  className="hover:text-danger"
                  onClick={() => onPatch({ sets: exercise.sets.filter((s) => s.key !== set.key) })}>
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ol>
          <Button
            variant="ghost"
            size="sm"
            disabled={exercise.sets.length >= maxSetsPerExercise}
            aria-label={`Add a set to ${name}`}
            onClick={onAddSet}>
            <Plus className="h-4 w-4" />
            Add set
          </Button>
        </div>
      )}
    </Card>
  );
}
