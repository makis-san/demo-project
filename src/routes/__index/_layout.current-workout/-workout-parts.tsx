import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Plus, Repeat2, SlidersHorizontal, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Stat } from "@/components/stat";
import { StepButton, stepValue } from "@/components/stepper";
import { RestLengthButton, type RestTimerState } from "@/components/rest-timer";
import { SetValues } from "@/components/set-values";
import type { MovementOption } from "@/components/movement-card";
import { formatClock } from "@/lib/use-now";
import { weightUnit } from "@/lib/units";
import { cn } from "@/lib/utils";

export type LoggedSet = {
  id: string;
  reps: number;
  weight: number;
  createdAt: Date | string;
  movement: { id: string; name: string; isBodyWeight: boolean };
};

/** What the history says about a movement, from its completed workouts. */
export type MovementHistory = { lastTop: number; lastDay: string; best: number } | null;

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const volumeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export const formatDay = (day: string) => dayFormat.format(Date.parse(`${day}T00:00:00Z`));
export const volumeOf = (sets: { weight: number; reps: number }[]) =>
  sets.reduce((sum, set) => sum + set.weight * set.reps, 0);

/**
 * Which sets beat the movement's best from earlier workouts. Each set is compared with the best so far, this
 * session included, so 100, 105, 110 over an old best of 100 is two PRs. With no history there is nothing to beat.
 */
export function personalRecords(sets: LoggedSet[], history: Map<string, MovementHistory>) {
  const prs = new Set<string>();
  const best = new Map<string, number>();
  for (const set of sets) {
    const past = history.get(set.movement.id);
    if (!past) continue;
    const current = best.get(set.movement.id) ?? past.best;
    if (set.weight > current) {
      prs.add(set.id);
      best.set(set.movement.id, set.weight);
    }
  }
  return prs;
}

/* ------------------------------------------------------------------------------------------------------------ */

type ComposerProps = {
  selectedMovement: MovementOption;
  weight: string;
  onWeightChange: (value: string) => void;
  reps: string;
  onRepsChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
  needsBodyWeight: React.ReactNode;
  history: MovementHistory | undefined;
  /** Where − and + start from on an empty field: the last weight and reps for this movement. */
  startWeight?: number;
  startReps?: number;
  nextSetNumber: number;
  timer: RestTimerState;
};

/**
 * Logging a set, built for one thumb between sets: nudge weight and reps with − and + (hold to run), then Add. It is for
 * the movement picked with "Add movement", from a chip of this session, or from "Adjust" on a planned set. The movement
 * is not chosen here: the sheet that picks it is opened from the page's "Add movement" button.
 */
export function SetComposer(props: ComposerProps) {
  const selected = props.selectedMovement;
  const canAdd = !!props.reps && !!props.weight;

  let hint = " ";
  if (props.history === null) hint = "First time logging this one";
  else if (props.history)
    hint = `Last top set ${numberFormat.format(props.history.lastTop)} ${weightUnit} · ${formatDay(props.history.lastDay)} · Best ${numberFormat.format(props.history.best)}`;

  return (
    <Card className="enter enter-2 z-10 p-3 sm:p-4">
      <form onSubmit={props.onSubmit} className="space-y-3">
        <div
          role="group"
          aria-label="Selected movement"
          className="rounded-[1.25rem] border border-line bg-black/25 px-4 py-3.5">
          <p className="eyebrow">Movement</p>
          <p className="mt-1 truncate text-xl font-semibold tracking-tight text-chalk font-stretch-[108%]">
            {selected.name}
          </p>
          <p className="num mt-0.5 min-h-4 truncate text-xs text-muted">{hint}</p>
        </div>

        <NumberDial
          label={`Weight · ${weightUnit}`}
          field={
            <Input
              type="number"
              aria-label="Weight"
              placeholder="–"
              inputMode="decimal"
              value={props.weight}
              onChange={(e) => props.onWeightChange(e.target.value)}
              min={0}
              max={9999.99}
              step="0.01"
              className={dialInputClass}
            />
          }
          onDown={() => props.onWeightChange(stepValue(props.weight, -5, { start: props.startWeight }))}
          onUp={() => props.onWeightChange(stepValue(props.weight, 5, { start: props.startWeight }))}
          downText="5 less weight"
          upText="5 more weight"
        />
        <NumberDial
          label="Reps"
          field={
            <Input
              type="number"
              aria-label="Reps"
              placeholder="–"
              inputMode="numeric"
              value={props.reps}
              onChange={(e) => props.onRepsChange(e.target.value)}
              min={1}
              max={1000}
              className={dialInputClass}
            />
          }
          onDown={() => props.onRepsChange(stepValue(props.reps, -1, { min: 1, start: props.startReps ?? 5 }))}
          onUp={() => props.onRepsChange(stepValue(props.reps, 1, { min: 1, start: props.startReps ?? 5 }))}
          downText="One rep less"
          upText="One rep more"
        />

        {props.needsBodyWeight}

        <div className="flex gap-2 pt-1">
          <RestLengthButton timer={props.timer} />
          <Button type="submit" disabled={!canAdd} className="h-12 flex-1 text-base">
            <Plus className="h-5 w-5" />
            {props.isPending ? "Adding..." : "Add"}
            {selected && !props.isPending && (
              <span aria-hidden="true" className="num font-medium opacity-70">
                · set {props.nextSetNumber}
              </span>
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * The movements already used in this session, newest first, as chips: one tap picks a movement and its last weight and
 * reps again, to log another set of it.
 */
export function RecentMovements({
  recent,
  selectedId,
  onPick,
}: {
  recent: { movement: LoggedSet["movement"]; last: LoggedSet }[];
  selectedId: string | undefined;
  onPick: (set: LoggedSet) => void;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <p className="eyebrow mb-2 px-1">This session</p>
      <div className="flex gap-2 pb-1">
        {recent.map(({ movement, last }) => (
          <button
            key={movement.id}
            type="button"
            onClick={() => onPick(last)}
            className={cn(
              "press flex shrink-0 flex-col items-start rounded-2xl border px-3.5 py-2 text-left",
              movement.id === selectedId
                ? "border-primary/60 bg-primary/12 text-chalk"
                : "border-line bg-white/[0.04] text-muted hover:border-line-strong hover:text-chalk",
            )}>
            <span className="max-w-40 truncate text-sm font-semibold text-chalk">{movement.name}</span>
            <span className="num text-xs">
              {last.reps} × {numberFormat.format(last.weight)} {weightUnit}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const dialInputClass =
  "h-14 rounded-2xl border-transparent bg-transparent text-center text-[1.75rem] font-bold tracking-tight font-stretch-[88%] " +
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none " +
  "hover:border-transparent focus-visible:bg-black/30";

function NumberDial({
  label,
  field,
  onDown,
  onUp,
  downText,
  upText,
}: {
  label: string;
  field: React.ReactNode;
  onDown: () => void;
  onUp: () => void;
  downText: string;
  upText: string;
}) {
  return (
    <div className="rounded-[1.25rem] border border-line bg-black/25 px-2 pt-2.5 pb-2">
      <p className="eyebrow text-center" aria-hidden="true">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <StepButton direction="down" onStep={onDown}>
          {downText}
        </StepButton>
        <div className="min-w-0 flex-1">{field}</div>
        <StepButton direction="up" onStep={onUp}>
          {upText}
        </StepButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------ */

/**
 * The sets, grouped by movement in the order each was first lifted, numbered within the movement. Each row says
 * how long the rest before it was, and a PR badge marks a weight heavier than the movement's best so far.
 * Every row still carries the movement's name (hidden), so a row read on its own says what it was.
 */
export function SetList({
  sets,
  prs,
  newestId,
  onRemove,
  onRepeat,
  repeatPending,
}: {
  sets: LoggedSet[];
  prs: Set<string>;
  newestId: string | undefined;
  onRemove: (set: LoggedSet) => void;
  onRepeat: (set: LoggedSet) => void;
  repeatPending: boolean;
}) {
  const groups: { movement: LoggedSet["movement"]; sets: LoggedSet[] }[] = [];
  for (const set of sets) {
    const group = groups.find((g) => g.movement.id === set.movement.id);
    if (group) group.sets.push(set);
    else groups.push({ movement: set.movement, sets: [set] });
  }
  // The rest before a set is the gap since the set before it, whatever movement that was.
  const restBefore = new Map<string, number>();
  sets.forEach((set, i) => {
    if (i > 0)
      restBefore.set(set.id, (new Date(set.createdAt).getTime() - new Date(sets[i - 1].createdAt).getTime()) / 1000);
  });

  return (
    <div className="space-y-3">
      {groups.map(({ movement, sets: groupSets }) => {
        const last = groupSets[groupSets.length - 1];
        return (
          <Card key={movement.id} className="enter p-2 sm:p-3">
            <div className="flex items-center gap-3 px-3 pt-2 pb-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold tracking-tight text-chalk font-stretch-[108%]">
                  {movement.name}
                </p>
                <p className="num text-xs text-muted">
                  {groupSets.length} {groupSets.length === 1 ? "set" : "sets"} ·{" "}
                  {volumeFormat.format(volumeOf(groupSets))} {weightUnit}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRepeat(last)}
                disabled={repeatPending}
                className="press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 text-sm font-semibold text-chalk hover:bg-white/[0.12] disabled:opacity-50">
                <Repeat2 className="h-4 w-4 text-accent" aria-hidden="true" />
                <span className="num">
                  {last.reps} × {numberFormat.format(last.weight)}
                </span>
                <span className="sr-only">: log the same {movement.name} set again</span>
              </button>
            </div>
            <ul className="space-y-1">
              {groupSets.map((set, i) => {
                const rest = restBefore.get(set.id);
                const isPr = prs.has(set.id);
                return (
                  <li
                    key={set.id}
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-2xl bg-well py-1.5 pr-1.5 pl-3",
                      set.id === newestId && "enter shadow-[inset_3px_0_0_var(--color-primary)]",
                    )}>
                    <span className="num w-11 shrink-0 text-xs font-semibold text-faint" aria-hidden="true">
                      SET {i + 1}
                    </span>
                    <span className="sr-only">{set.movement.name}</span>
                    <SetValues set={set} />
                    {isPr && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-accent">
                        <Trophy className="h-3 w-3" aria-hidden="true" /> PR
                      </span>
                    )}
                    {rest !== undefined && rest >= 5 && (
                      <span className="num hidden shrink-0 text-xs text-faint sm:inline" title="Rest before this set">
                        {formatClock(rest)} rest
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${set.movement.name} set`}
                      onClick={() => onRemove(set)}
                      className="h-10 w-10 shrink-0 text-faint hover:text-danger">
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------ */

/** A set from the workout this one was repeated from: a plan, not a logged set. */
export type PlannedSet = {
  id: string;
  reps: number;
  /** Optional in a preset: a value to help track progress. */
  weight: number | null;
  /** The rest a preset asks for after this set. Null for a repeated workout. */
  restSeconds: number | null;
  movement: LoggedSet["movement"];
};

const plannedText = (set: { reps: number; weight: number | null }) =>
  `${set.reps} × ${set.weight === null ? "no weight" : `${set.weight} ${weightUnit}`}`;

/**
 * Which planned sets are already done. Nothing is stored for it: the nth planned set of a movement is done once the
 * workout has n sets of that movement, however the user logged them (with the old numbers or changed ones). So a
 * reload keeps the ticks, and removing a logged set un-ticks the last one.
 */
export function plannedProgress(plan: PlannedSet[], logged: LoggedSet[]) {
  const loggedCount = new Map<string, number>();
  for (const set of logged) loggedCount.set(set.movement.id, (loggedCount.get(set.movement.id) ?? 0) + 1);
  const seen = new Map<string, number>();
  const done = new Set<string>();
  for (const planned of plan) {
    const n = (seen.get(planned.movement.id) ?? 0) + 1;
    seen.set(planned.movement.id, n);
    if (n <= (loggedCount.get(planned.movement.id) ?? 0)) done.add(planned.id);
  }
  return done;
}

/**
 * The checklist of a repeated workout. Tapping a planned set logs it with the old weight and reps. "Adjust" loads
 * it into the form instead, so either can be changed before adding. Planned sets are not real until they are logged,
 * so skipping one leaves nothing in history, charts or PRs.
 */
export function PlannedSets({
  plan,
  source,
  logged,
  onLog,
  onAdjust,
  pending,
  colors,
  currentId,
  onFocusMovement,
}: {
  plan: PlannedSet[];
  /** Where the plan comes from: the preset's name, or the date of the workout it repeats. */
  source: string;
  logged: LoggedSet[];
  onLog: (set: PlannedSet) => void;
  onAdjust: (set: PlannedSet) => void;
  pending: boolean;
  /** The ring's colour for each movement, so a movement here and its arc on the ring match. */
  colors?: Map<string | null, string>;
  /** The ring's current movement: its sets are the ones to do now. */
  currentId?: string | null;
  /** Makes a movement the current one on the ring, from a tap on its name. */
  onFocusMovement?: (movement: PlannedSet["movement"]) => void;
}) {
  const done = plannedProgress(plan, logged);
  const groups: { movement: PlannedSet["movement"]; sets: PlannedSet[] }[] = [];
  for (const set of plan) {
    const group = groups.find((g) => g.movement.id === set.movement.id);
    if (group) group.sets.push(set);
    else groups.push({ movement: set.movement, sets: [set] });
  }

  return (
    <Card role="region" className="enter p-2 sm:p-3" aria-label="Planned sets">
      <div className="flex items-center justify-between gap-3 px-3 pt-2 pb-3">
        <div className="min-w-0">
          <p className="eyebrow">Planned from {source}</p>
          <p className="num text-base font-semibold tracking-tight text-chalk font-stretch-[108%]">
            {done.size} of {plan.length} logged
          </p>
        </div>
      </div>
      {/* One segment per planned set, in the ring's colours, filled as sets are logged. */}
      <div aria-hidden="true" className="mx-3 mb-4 flex gap-1">
        {plan.map((set) => (
          <span key={set.id} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <span
              className="block h-full origin-left rounded-full transition-transform duration-500 ease-[var(--ease-enter)]"
              style={{
                background: colors?.get(set.movement.id) ?? "var(--color-ok)",
                transform: `scaleX(${done.has(set.id) ? 1 : 0})`,
              }}
            />
          </span>
        ))}
      </div>
      <div className="space-y-3">
        {groups.map(({ movement, sets }) => {
          const color = colors?.get(movement.id);
          const isCurrent = currentId === movement.id;
          return (
            <div
              key={movement.id}
              data-current={isCurrent}
              className={cn(
                "rounded-[1.4rem] p-1 transition-[background-color,box-shadow] duration-500",
                isCurrent && "bg-white/[0.035]",
              )}
              style={
                isCurrent && color
                  ? { boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${color} 45%, transparent)` }
                  : undefined
              }>
              <button
                type="button"
                onClick={() => onFocusMovement?.(movement)}
                disabled={!onFocusMovement || isCurrent}
                aria-label={
                  isCurrent ? `${movement.name}, the current movement` : `Make ${movement.name} the current movement`
                }
                className="group flex w-full min-w-0 items-center gap-2 px-2 pt-1 pb-1.5 text-left disabled:cursor-default">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full transition-transform duration-300 group-hover:scale-125"
                  style={{ background: color ?? "var(--color-faint)" }}
                />
                <span className={cn("truncate text-sm font-semibold", isCurrent ? "text-chalk" : "text-muted")}>
                  {movement.name}
                </span>
                {isCurrent && (
                  <span
                    className="orbit-swap rounded-full px-2 py-0.5 text-[0.65rem] font-bold tracking-wider text-ground uppercase"
                    style={{ background: color }}>
                    Now
                  </span>
                )}
              </button>
              <ul className="space-y-1" aria-label={`Planned ${movement.name} sets`}>
                {sets.map((set) => {
                  const isDone = done.has(set.id);
                  return (
                    <li
                      key={set.id}
                      data-done={isDone}
                      className={cn(
                        "flex items-center gap-2 rounded-2xl bg-well py-1.5 pr-1.5 pl-3 transition-opacity duration-500",
                        isDone && "opacity-50",
                      )}>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors duration-300",
                          isDone ? "border-ok bg-ok/20 text-ok" : "border-line-strong text-transparent",
                        )}>
                        <Check key={String(isDone)} className={cn("h-3.5 w-3.5", isDone && "orbit-pop")} />
                      </span>
                      <span className="num min-w-0 flex-1 text-sm whitespace-nowrap text-muted">
                        <span className="text-lg font-bold text-chalk">{set.reps}</span> reps ×{" "}
                        {set.weight === null ? (
                          <span className="text-faint">no weight</span>
                        ) : (
                          <>
                            <span className="text-lg font-bold text-chalk">{set.weight}</span> {weightUnit}
                          </>
                        )}
                      </span>
                      {isDone ? (
                        <span className="pr-3 text-xs font-semibold text-ok">Logged</span>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Adjust planned ${movement.name} set: ${plannedText(set)}`}
                            onClick={() => onAdjust(set)}
                            className="h-10 px-3 text-muted">
                            <SlidersHorizontal className="h-4 w-4" />
                            Adjust
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={pending}
                            aria-label={`Log planned ${movement.name} set: ${plannedText(set)}`}
                            onClick={() => onLog(set)}
                            className="h-10 px-4">
                            Log
                          </Button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export type Recap = { seconds: number; sets: number; volume: number; prs: number };

/** Shown after Finish: the session's numbers count up once, then it points to the history. */
export function RecapCard({ recap, onDismiss }: { recap: Recap; onDismiss: () => void }) {
  const [shown, setShown] = useState<Recap>({ seconds: 0, sets: 0, volume: 0, prs: 0 });
  useEffect(() => {
    const id = window.setTimeout(() => setShown(recap), 150);
    return () => window.clearTimeout(id);
  }, [recap]);

  return (
    <Card className="enter overflow-hidden border-ok/30 p-5 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <p className="eyebrow text-ok">Workout saved</p>
          <p className="text-2xl font-bold tracking-tight text-chalk font-stretch-[115%]">Session complete</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onDismiss} className="-mt-1 -mr-2 text-faint">
          <X className="h-4 w-4" />
          <span className="sr-only">Close the summary</span>
        </Button>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
        <Stat label="Duration" value={formatClock(shown.seconds)} morph />
        <Stat label="Sets" value={shown.sets} morph />
        <Stat label="Volume" value={volumeFormat.format(shown.volume)} unit={weightUnit} morph />
        <Stat label="PRs" value={shown.prs} morph />
      </div>
      <Link
        to="/workout-history"
        className="mt-6 inline-flex text-sm font-semibold text-accent underline-offset-4 hover:underline">
        See it in your history
      </Link>
    </Card>
  );
}
