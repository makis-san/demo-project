import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronsUpDown, Flag, Plus, Repeat2, SlidersHorizontal, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Stat } from "@/components/stat";
import { StepButton, stepValue } from "@/components/stepper";
import { RestLengthButton, type RestTimerState } from "@/components/rest-timer";
import { SetValues } from "@/components/set-values";
import type { MovementOption } from "@/components/movement-card";
import { formatClock, useNow } from "@/lib/use-now";
import { elapsedMs, isPaused, type WorkoutTimeline } from "@/lib/workout-timeline";
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
export type MovementHistory = { lastTop: number; lastTopReps: number; lastDay: string; best: number } | null;

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

/**
 * The top of the focus screen on a phone, in place of the page header: a button that leaves without ending the
 * workout, the workout clock, and Finish. The clock shows the same time as the ring's, pauses left out.
 */
export function PhoneTopBar({
  timeline,
  startedAt,
  onFinish,
  finishing,
  showFinish,
}: {
  timeline: WorkoutTimeline | null;
  startedAt: Date | string;
  onFinish: () => void;
  finishing: boolean;
  /** Not when the ring offers a big Finish of its own. */
  showFinish: boolean;
}) {
  const paused = timeline ? isPaused(timeline) : false;
  const now = useNow(1000, true);
  // Before the browser takes over there is no clock, so the server and the browser agree on 0:00. While paused the
  // clock stands at the moment the pause began.
  const at = timeline && paused ? timeline.pauses[timeline.pauses.length - 1].startedAt : now;
  const elapsed =
    at === null ? 0 : timeline ? elapsedMs(timeline, at) : Math.max(0, at - new Date(startedAt).getTime());
  return (
    <div className="sticky top-0 z-20 -mx-4 mb-3 grid grid-cols-[3rem_1fr_auto] items-center gap-2 bg-ground/85 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 backdrop-blur-md md:hidden">
      <Link
        to="/home"
        aria-label="Minimize workout"
        title="Minimize workout"
        className="press grid h-11 w-11 place-items-center rounded-full bg-white/[0.07] text-chalk">
        <ChevronDown className="h-5 w-5" />
      </Link>
      <p
        aria-hidden="true"
        className={cn(
          "num text-center text-xl font-bold tracking-tight text-chalk font-stretch-[88%]",
          paused && "text-accent",
        )}>
        {formatClock(elapsed / 1000)}
        {paused && <span className="ml-2 text-xs font-medium">Paused</span>}
      </p>
      {showFinish ? (
        <button
          type="button"
          onClick={onFinish}
          disabled={finishing}
          aria-label={finishing ? "Finishing..." : "Finish Workout"}
          className="press flag-button relative flex h-11 items-center justify-center overflow-hidden rounded-full border border-white/25 disabled:opacity-60">
          <span aria-hidden="true" className="checkered absolute inset-0" />
          <span className="relative inline-flex items-center gap-1.5 rounded-full bg-ground/90 px-3 py-1.5 text-sm font-semibold text-chalk">
            <Flag className="h-4 w-4" fill="currentColor" />
            {finishing ? "Finishing..." : "Finish"}
          </span>
        </button>
      ) : (
        <span className="w-11" />
      )}
    </div>
  );
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

const shortHint = (history: MovementHistory | undefined) => {
  if (history === null) return "First time logging this one";
  // A body-weight movement with nothing added was lifted at 0: say the reps, not "0 lbs".
  if (history) {
    const top =
      history.lastTop > 0 ? `${numberFormat.format(history.lastTop)} ${weightUnit}` : `${history.lastTopReps} reps`;
    return `Last top set ${top} · ${formatDay(history.lastDay)}`;
  }
  return " ";
};

/** The Add button of both composers: the one red button of the screen. */
function AddButton({ composer, className }: { composer: ComposerProps; className?: string }) {
  return (
    <Button
      type="submit"
      disabled={!composer.reps || !composer.weight}
      className={cn("h-12 flex-1 text-base", className)}>
      <Plus className="h-5 w-5" />
      {composer.isPending ? "Adding..." : "Add"}
      {!composer.isPending && (
        <span aria-hidden="true" className="num font-medium opacity-70">
          · set {composer.nextSetNumber}
        </span>
      )}
    </Button>
  );
}

/** The weight and reps fields, with the − and + beside each. The same fields in both composers, so tests find one. */
function weightField(composer: ComposerProps, className: string, style?: React.CSSProperties) {
  return (
    <Input
      type="number"
      aria-label="Weight"
      placeholder="–"
      inputMode="decimal"
      value={composer.weight}
      onChange={(e) => composer.onWeightChange(e.target.value)}
      min={0}
      max={9999.99}
      step="0.01"
      className={className}
      style={style}
    />
  );
}
function repsField(composer: ComposerProps, className: string, style?: React.CSSProperties) {
  return (
    <Input
      type="number"
      aria-label="Reps"
      placeholder="–"
      inputMode="numeric"
      value={composer.reps}
      onChange={(e) => composer.onRepsChange(e.target.value)}
      min={1}
      max={1000}
      className={className}
      style={style}
    />
  );
}
const weightSteps = (composer: ComposerProps) => ({
  onDown: () => composer.onWeightChange(stepValue(composer.weight, -5, { start: composer.startWeight })),
  onUp: () => composer.onWeightChange(stepValue(composer.weight, 5, { start: composer.startWeight })),
  downText: "5 less weight",
  upText: "5 more weight",
});
const repsSteps = (composer: ComposerProps) => ({
  onDown: () => composer.onRepsChange(stepValue(composer.reps, -1, { min: 1, start: composer.startReps ?? 5 })),
  onUp: () => composer.onRepsChange(stepValue(composer.reps, 1, { min: 1, start: composer.startReps ?? 5 })),
  downText: "One rep less",
  upText: "One rep more",
});

/**
 * Logging a set from md up, in the page: nudge weight and reps with − and + (hold to run), then Add. It is for the
 * movement picked with "Add movement", from a chip of this session, or from "Adjust" on a planned set. The movement
 * is not chosen here: the sheet that picks it is opened from the page's "Add movement" button.
 */
export function SetComposer(props: ComposerProps) {
  const selected = props.selectedMovement;
  let hint = shortHint(props.history);
  if (props.history) hint += ` · Best ${numberFormat.format(props.history.best)}`;

  return (
    <Card className="enter enter-2 z-10 p-3 sm:p-4">
      <form onSubmit={props.onSubmit} className="space-y-3">
        <div role="group" aria-label="Selected movement" className="rounded-[1.25rem] bg-black/25 px-4 py-3.5">
          <p className="truncate text-xl font-semibold tracking-tight text-chalk font-stretch-[108%]">
            {selected.name}
          </p>
          <p className="num mt-0.5 min-h-4 truncate text-xs text-muted">{hint}</p>
        </div>

        <NumberDial
          label={`Weight · ${weightUnit}`}
          field={weightField(props, dialInputClass)}
          {...weightSteps(props)}
        />
        <NumberDial label="Reps" field={repsField(props, dialInputClass)} {...repsSteps(props)} />

        {props.needsBodyWeight}

        <div className="flex gap-2 pt-1">
          <RestLengthButton timer={props.timer} />
          <AddButton composer={props} />
        </div>
      </form>
    </Card>
  );
}

/**
 * The composer on a phone: a bar fixed to the bottom of the screen, in both panes. With a movement it is a row to
 * change it (name and last top set), weight and reps side by side, and Add with the rest length. Without one it is a
 * single "Add movement" button. It reports its height, so the page leaves room under its content and the rest timer
 * floats just above it.
 */
export function PhoneComposer({
  composer,
  onChoose,
  onHeight,
}: {
  composer: (Omit<ComposerProps, "selectedMovement"> & { selectedMovement: MovementOption | null }) | null;
  onChoose: () => void;
  onHeight: (px: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const report = () => onHeightRef.current(el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      observer.disconnect();
      onHeightRef.current(0);
    };
  }, []);

  const selected = composer?.selectedMovement ?? null;
  const full = selected ? ({ ...composer, selectedMovement: selected } as ComposerProps) : null;

  return (
    <div ref={bar} className="fixed inset-x-0 bottom-0 z-30 md:hidden">
      <div className="glass glass-strong rounded-t-[1.5rem] rounded-b-none border-x-0 border-b-0 border-t border-t-line-strong bg-ground/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] [@media(max-height:700px)]:pt-2">
        {full && selected ? (
          <form onSubmit={full.onSubmit} className="space-y-2">
            <div role="group" aria-label="Selected movement">
              <button
                type="button"
                onClick={onChoose}
                aria-label={`Change movement, ${selected.name}`}
                className="press flex min-h-11 w-full items-center gap-3 rounded-2xl px-1 text-left [@media(max-height:700px)]:min-h-8">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base leading-tight font-semibold text-chalk font-stretch-[108%]">
                    {selected.name}
                  </span>
                  <span className="num block min-h-4 truncate text-xs text-muted [@media(max-height:700px)]:hidden">
                    {shortHint(full.history)}
                  </span>
                </span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <CompactDial
                label={`Weight · ${weightUnit}`}
                unit={weightUnit}
                field={weightField(full, compactInputClass, digits(full.weight))}
                {...weightSteps(full)}
              />
              <CompactDial
                label="Reps"
                unit="reps"
                field={repsField(full, compactInputClass, digits(full.reps))}
                {...repsSteps(full)}
              />
            </div>
            {full.needsBodyWeight}
            <div className="flex gap-2">
              <RestLengthButton timer={full.timer} compact />
              <AddButton composer={full} />
            </div>
          </form>
        ) : (
          <Button type="button" size="lg" onClick={onChoose} className="w-full">
            <Plus className="h-5 w-5" />
            Add movement
          </Button>
        )}
      </div>
    </div>
  );
}

const compactInputClass =
  "h-11 min-w-0 flex-1 rounded-xl border-transparent bg-transparent px-0 text-center text-xl [@media(max-height:700px)]:w-(--digits) [@media(max-height:700px)]:flex-none font-bold tracking-tight font-stretch-[88%] " +
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none " +
  "hover:border-transparent focus-visible:bg-black/30";

/** The width of a number in the stepper on a short phone, where the unit sits right after it. */
const digits = (value: string) => ({ "--digits": `${Math.max(value.length, 1) + 0.5}ch` }) as React.CSSProperties;

function CompactDial({
  label,
  unit,
  field,
  onDown,
  onUp,
  downText,
  upText,
}: {
  label: string;
  /** Shown after the number when the label above is left out for a short screen. */
  unit: string;
  field: React.ReactNode;
  onDown: () => void;
  onUp: () => void;
  downText: string;
  upText: string;
}) {
  return (
    <div className="rounded-2xl bg-black/25 px-1 pt-1.5 pb-1 [@media(max-height:700px)]:pt-1">
      <p
        className="text-center text-[11px] leading-none text-muted [@media(max-height:700px)]:hidden"
        aria-hidden="true">
        {label}
      </p>
      <div className="mt-1 flex items-center">
        <StepButton direction="down" onStep={onDown} className="h-11 w-11 border-transparent bg-transparent">
          {downText}
        </StepButton>
        <div className="flex min-w-0 flex-1 items-center justify-center [@media(max-height:700px)]:gap-1">
          {field}
          <span
            aria-hidden="true"
            className="num hidden shrink-0 text-xs font-medium text-muted [@media(max-height:700px)]:inline">
            {unit}
          </span>
        </div>
        <StepButton direction="up" onStep={onUp} className="h-11 w-11 border-transparent bg-transparent">
          {upText}
        </StepButton>
      </div>
    </div>
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
      <p className="mb-2 px-1 text-[13px] font-medium text-muted">This session</p>
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
    <div className="rounded-[1.25rem] bg-black/25 px-2 pt-2.5 pb-2">
      <p className="text-center text-[13px] text-muted" aria-hidden="true">
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
                    <span className="num w-11 shrink-0 text-xs text-muted" aria-hidden="true">
                      Set {i + 1}
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

/** A planned set in words: "10 reps", or "10 × 100 lbs" when it has a weight. */
export const plannedText = (set: { reps: number; weight: number | null }) =>
  set.weight === null ? `${set.reps} reps` : `${set.reps} × ${set.weight} ${weightUnit}`;

/**
 * Which planned sets are already done. Nothing is stored for it: the nth planned set of a movement is done once the
 * workout has n sets of that movement, however the user logged them (with the old numbers or changed ones). So a
 * reload keeps the ticks, and removing a logged set un-ticks the last one.
 */
/** The set that was logged for each planned set that is done: the nth of a movement for its nth planned set. */
export function plannedLogged(plan: PlannedSet[], logged: LoggedSet[]) {
  const byMovement = new Map<string, LoggedSet[]>();
  for (const set of logged) byMovement.set(set.movement.id, [...(byMovement.get(set.movement.id) ?? []), set]);
  const seen = new Map<string, number>();
  const result = new Map<string, LoggedSet>();
  for (const planned of plan) {
    const n = seen.get(planned.movement.id) ?? 0;
    seen.set(planned.movement.id, n + 1);
    const set = byMovement.get(planned.movement.id)?.[n];
    if (set) result.set(planned.id, set);
  }
  return result;
}

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
  const loggedFor = plannedLogged(plan, logged);
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
          <p className="text-[13px] text-muted">Planned from {source}</p>
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
                  // A done set shows what was logged, which may not be what was planned.
                  const shown = loggedFor.get(set.id) ?? set;
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
                        <span className="text-lg font-bold text-chalk">{shown.reps}</span> reps
                        {shown.weight !== null && (
                          <>
                            {" "}
                            × <span className="text-lg font-bold text-chalk">{shown.weight}</span> {weightUnit}
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
          <p className="text-sm font-medium text-ok">Workout saved</p>
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
