import { useEffect, useId, useRef, useState } from "react";
import { ChevronsRight, Flag, Pause, Play, Plus, SkipForward } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/stat";
import { formatClock, useNow } from "@/lib/use-now";
import { weightUnit } from "@/lib/units";
import { cn } from "@/lib/utils";
import { activeMs, currentSection, elapsedMs, isPaused, sectionMs, type WorkoutTimeline } from "@/lib/workout-timeline";
import { volumeOf, type LoggedSet, type PlannedSet } from "./-workout-parts";

/** One movement of the plan, in the plan's order, with how many sets it has and the rest after each. */
export type PlannedGroup = { movement: PlannedSet["movement"]; total: number; restSeconds: number | null };

export function plannedGroups(plan: PlannedSet[] | null | undefined): PlannedGroup[] {
  const groups: PlannedGroup[] = [];
  for (const set of plan ?? []) {
    const group = groups.find((g) => g.movement.id === set.movement.id);
    if (group) group.total += 1;
    else groups.push({ movement: set.movement, total: 1, restSeconds: set.restSeconds });
  }
  return groups;
}

export const loggedCounts = (sets: LoggedSet[]) => {
  const counts = new Map<string, number>();
  for (const set of sets) counts.set(set.movement.id, (counts.get(set.movement.id) ?? 0) + 1);
  return counts;
};

/** A guess at the time one set takes, before its rest, for the ghost of what is still planned. */
const setWorkSeconds = 40;
/** Without a plan the ring is a clock face of quarter hours: it fills over 15 minutes, then over 30, and so on. */
const freeScaleMs = 15 * 60_000;

/**
 * The movements' colours on the ring, in the order they first appear. The current one is drawn lit, the finished ones
 * dimmer, and the planned ones as a ghost of the same colour. Hues spread around the brand red, all light enough for
 * the dark ground.
 */
const palette = [
  "oklch(66% 0.2 27)",
  "oklch(80% 0.11 195)",
  "oklch(82% 0.13 80)",
  "oklch(72% 0.14 300)",
  "oklch(80% 0.14 145)",
  "oklch(72% 0.12 245)",
];
export const warmUpColor = "oklch(75% 0.012 20)";

/** Each movement's colour, shared by the ring, its legend and the planned sets, so they read as one thing. */
export function movementColors(timeline: WorkoutTimeline | null, groups: PlannedGroup[]) {
  const colors = new Map<string | null, string>([[null, warmUpColor]]);
  for (const id of [...(timeline?.sections.map((s) => s.movementId) ?? []), ...groups.map((g) => g.movement.id)]) {
    if (!colors.has(id)) colors.set(id, palette[(colors.size - 1) % palette.length]);
  }
  return colors;
}

type Arc = {
  key: string;
  movementId: string | null;
  start: number;
  length: number;
  kind: "done" | "current" | "ghost";
};

type LegendItem = {
  movementId: string | null;
  name: string;
  color: string;
  ms: number;
  ghostMs: number;
  state: "current" | "done" | "upcoming";
};

/**
 * Lays the workout out on the ring, as fractions of a whole from 0 to 1.
 *
 * - Each section of the timeline is an arc as long as the time spent in it, pauses left out. Only the open one grows.
 * - With a plan, a ghost follows: the rest of the current movement's expected time, then each planned movement with
 *   sets still to do. The expected time is sets × (a set + its rest). The whole ring is the time spent plus what is
 *   still expected, so the ghost shrinks as the real arcs take its place, and running long squeezes everything.
 *   The ghost is not drawn: it sizes the ring, so the time spent fills it as the workout goes, and feeds the legend.
 * - Without a plan, the ring is the elapsed time rounded up to the next quarter hour.
 * - A pause is a break: a line across the ring where it happened. It has no length, because paused time does not count.
 */
export function ringLayout(
  timeline: WorkoutTimeline,
  now: number,
  groups: PlannedGroup[],
  logged: Map<string, number>,
  defaultRestSeconds: number,
) {
  const sections = timeline.sections.map((section, i) => ({ section, i, ms: sectionMs(timeline, section, now) }));
  const spent = new Map<string | null, number>();
  for (const { section, ms } of sections) spent.set(section.movementId, (spent.get(section.movementId) ?? 0) + ms);
  const currentId = currentSection(timeline).movementId;

  let currentGhostMs = 0;
  const ghosts: { movementId: string; ms: number }[] = [];
  for (const group of groups) {
    const left = group.total - (logged.get(group.movement.id) ?? 0);
    if (left <= 0) continue;
    const perSet = (setWorkSeconds + (group.restSeconds ?? defaultRestSeconds)) * 1000;
    const expected = group.total * perSet;
    if (group.movement.id === currentId) {
      // What is left of its expected time, but never more than the sets still to do: two quick sets leave one to go.
      currentGhostMs = Math.max(0, Math.min(expected - (spent.get(currentId) ?? 0), left * perSet));
    } else ghosts.push({ movementId: group.movement.id, ms: (expected * left) / group.total });
  }

  const actualMs = sections.reduce((sum, s) => sum + s.ms, 0);
  const ghostMs = currentGhostMs + ghosts.reduce((sum, g) => sum + g.ms, 0);
  const planned = groups.length > 0;
  const scale = planned
    ? Math.max(actualMs + ghostMs, 1)
    : Math.max(freeScaleMs, Math.ceil(actualMs / freeScaleMs) * freeScaleMs);

  const arcs: Arc[] = [];
  let at = 0;
  for (const { section, i, ms } of sections) {
    arcs.push({
      key: `s${i}`,
      movementId: section.movementId,
      start: at / scale,
      length: ms / scale,
      kind: section.endedAt === null ? "current" : "done",
    });
    at += ms;
  }
  const headAt = at / scale;
  if (currentGhostMs > 0) {
    arcs.push({
      key: "g-current",
      movementId: currentId,
      start: at / scale,
      length: currentGhostMs / scale,
      kind: "ghost",
    });
    at += currentGhostMs;
  }
  for (const ghost of ghosts) {
    arcs.push({
      key: `g-${ghost.movementId}`,
      movementId: ghost.movementId,
      start: at / scale,
      length: ghost.ms / scale,
      kind: "ghost",
    });
    at += ghost.ms;
  }

  const start = timeline.sections[0].startedAt;
  const breaks = timeline.pauses.map((p, i) => ({
    key: `p${i}`,
    at: activeMs(timeline, start, p.startedAt) / scale,
    open: p.endedAt === null,
  }));

  return {
    arcs,
    breaks,
    headAt,
    actualMs,
    plannedMs: planned ? actualMs + ghostMs : null,
    spent,
    ghosts,
    currentGhostMs,
  };
}

/** One set on the inner ring. "next" is the set to do now, the one Next set logs. */
export type SetSlot = { key: string; movementId: string; state: "logged" | "next" | "planned" };

/**
 * The inner ring's sets, in the plan's order and then any movement added on the way. A planned movement has a slot per
 * planned set, or more if more were logged. A movement without a plan has its logged sets and, while it is the current
 * one, an empty slot for the next.
 */
export function setSlots(groups: PlannedGroup[], sets: LoggedSet[], currentId: string | null): SetSlot[] {
  const logged = loggedCounts(sets);
  const order = groups.map((g) => g.movement.id);
  for (const id of [...sets.map((s) => s.movement.id), ...(currentId ? [currentId] : [])]) {
    if (!order.includes(id)) order.push(id);
  }
  const slots: SetSlot[] = [];
  for (const id of order) {
    const planned = groups.find((g) => g.movement.id === id)?.total ?? 0;
    const done = logged.get(id) ?? 0;
    const count = Math.max(planned, done) + (planned === 0 && id === currentId ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const state = k < done ? "logged" : id === currentId && k === done ? "next" : "planned";
      slots.push({ key: `${id}-${k}`, movementId: id, state });
    }
  }
  return slots;
}

/** Where each slot goes on the inner ring, as fractions, with the wider gap where the movement changes. */
function slotArcs(slots: SetSlot[]) {
  const movements = slots.filter((slot, i) => slots[(i + 1) % slots.length].movementId !== slot.movementId).length;
  const boundaries = Math.max(movements, 1);
  const gaps = (slots.length - boundaries) * SET_GAP + boundaries * MOVEMENT_GAP;
  const length = (100 - gaps) / Math.max(slots.length, 1);
  let at = MOVEMENT_GAP / 2;
  return slots.map((slot, i) => {
    const arc = { ...slot, start: at / 100, length: length / 100 };
    const next = slots[i + 1];
    at += length + (next && next.movementId === slot.movementId ? SET_GAP : MOVEMENT_GAP);
    return arc;
  });
}

type RingProps = {
  timeline: WorkoutTimeline | null;
  title: string;
  plan: PlannedSet[] | null;
  sets: LoggedSet[];
  /** Movement names by id, for every movement the timeline can mention. */
  names: Map<string, string>;
  /** From `movementColors`, shared with the planned sets. */
  colors: Map<string | null, string>;
  defaultRestSeconds: number;
  /** The movement Next goes to, or null when Next opens the sheet to pick one. */
  nextName: string | null;
  /** No planned movement is left: Next ends the plan, pausing on Finish and Add. */
  nextEndsPlan: boolean;
  onNext: () => void;
  /** Every planned set of the current movement is done: Next set logs nothing more and moves on, as "Up next". */
  nextSetMovesOn: boolean;
  /** What Next set will log, shown under it: "10 × 100 lbs", how it will get the numbers, or where it moves on to. */
  nextSetDetail: string;
  onNextSet: () => void;
  /** A set is being logged: Next set waits, so a double tap logs one set. */
  nextSetPending: boolean;
  onTogglePause: () => void;
  onFinish: () => void;
  finishing: boolean;
  /** Every planned set is done and the workout is paused: only Finish and Add are offered. */
  complete: boolean;
  /** Opens the sheet to carry on with another movement, which resumes the workout. */
  onAdd: () => void;
};

const volumeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;

// The ring in a 120 × 120 box. pathLength="100" on each circle makes the dash lengths percentages of the ring.
const C = 60;
const R = 50;
const STROKE = 10;
/** The inner ring of sets: one short segment per set, grouped by movement. */
const R_SETS = 40;
const SET_STROKE = 3.6;
/** Gaps on the ring of sets, in percent: a small one between two sets, a wider one between two movements. */
const SET_GAP = 0.9;
const MOVEMENT_GAP = 2.8;
/** Movement names written along the outer ring, in its own units. */
const LABEL_SIZE = 3.6;
const labelWidth = (name: string) => name.length * (LABEL_SIZE * 0.66 + 0.35) + 3;
const CIRCUMFERENCE = 2 * Math.PI * R;
/** The space between the rounded ends of two arcs, in percent of the ring, so each section reads as its own pill. */
const GAP = 1.4;
/** How far a round end reaches past its dash, in percent of the ring. The dash is shortened by it at both ends. */
const capOf = (width: number, radius = R) => (width / 2 / (2 * Math.PI * radius)) * 100;
/** How long the head and the arcs take to move when the movement changes. Matches `.orbit-jump` in styles.css. */
const JUMP_MS = 550;
/** The shortest a movement's pill is drawn on the outer ring, round ends included, as a multiple of its width. */
const MIN_PILL = 3;
/**
 * The shortest share of the ring an arc gets, its gap included: a pill `MIN_PILL` times as long as it is wide. So a
 * movement just begun, or one of a few seconds, reads as a segment of its own and never as a dot.
 */
const MIN_ARC = (MIN_PILL * STROKE) / CIRCUMFERENCE + GAP / 100;

/**
 * Lays the drawn arcs end to end with an even gap, each at least `MIN_ARC` long, so short sections never shrink to
 * dots that overlap their neighbours. The extra room comes from the longer arcs and the empty track after them, in
 * proportion to how much each has to spare, so long arcs keep their proportions to each other. With more arcs than the
 * ring has room for, they share it equally.
 */
export function spaceOut<T extends { start: number; length: number }>(arcs: T[], min = MIN_ARC): T[] {
  if (arcs.length === 0) return arcs;
  const floor = Math.min(min, 1 / arcs.length);
  const rest = Math.max(0, 1 - arcs.reduce((sum, arc) => sum + arc.length, 0));
  const deficit = arcs.reduce((sum, arc) => sum + Math.max(0, floor - arc.length), 0);
  const spare = arcs.reduce((sum, arc) => sum + Math.max(0, arc.length - floor), 0) + rest;
  const give = spare > 0 ? Math.min(1, deficit / spare) : 0;
  let at = 0;
  return arcs.map((arc) => {
    const length = arc.length < floor ? floor : arc.length - (arc.length - floor) * give;
    const spaced = { ...arc, start: at, length };
    at += length;
    return spaced;
  });
}

/** Where a point of the workout, as a fraction of the ring before `spaceOut`, lands after it. */
function remap(
  fraction: number,
  before: { start: number; length: number }[],
  after: { start: number; length: number }[],
) {
  const i = before.findIndex((arc) => fraction <= arc.start + arc.length);
  if (i === -1) return after.length ? after[after.length - 1].start + after[after.length - 1].length : fraction;
  const share = before[i].length > 0 ? (fraction - before[i].start) / before[i].length : 0;
  return after[i].start + Math.max(0, share) * after[i].length;
}

/** The dash of an arc with round ends that start and stop inside its share of the ring. Too short for both: a dot. */
function roundedDash(arc: { start: number; length: number }, width: number, radius = R, gap = GAP) {
  const cap = capOf(width, radius);
  const length = arc.length * 100 - 2 * cap - gap;
  if (length <= 0) return { dash: "0.001 99.999", offset: -(arc.start + arc.length / 2) * 100 };
  return { dash: `${length} ${100 - length}`, offset: -(arc.start * 100 + cap + gap / 2) };
}

function point(fraction: number, radius: number) {
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  return { x: C + radius * Math.cos(angle), y: C + radius * Math.sin(angle) };
}

/**
 * The current workout as a ring: the workout clock in the middle, one rounded arc per movement around it, growing only
 * for the current movement and only while the clock runs. Pips on the ring are the sets, logged and planned. Below
 * it, Next, Pause and Finish. See `ringLayout` for what is drawn where, `useNextMotion` and styles.css for the motion.
 */
export function WorkoutRing(props: RingProps) {
  const { timeline, colors } = props;
  const paused = timeline ? isPaused(timeline) : false;
  // While paused nothing on the ring moves, so the clock stops ticking too.
  const now = useNow(1000, !paused);
  const groups = plannedGroups(props.plan);
  const logged = loggedCounts(props.sets);
  const nameOf = (id: string | null) => (id === null ? "Warm-up" : (props.names.get(id) ?? "Movement"));
  const colorOf = (id: string | null) => colors.get(id) ?? warmUpColor;

  // Before the browser takes over there is no clock: draw the empty ring and 0:00, so the server and browser agree.
  const at = timeline && now !== null ? (paused ? pausedNow(timeline) : now) : null;
  const layout = timeline && at !== null ? ringLayout(timeline, at, groups, logged, props.defaultRestSeconds) : null;
  const currentId = timeline ? currentSection(timeline).movementId : null;
  const elapsed = timeline && at !== null ? elapsedMs(timeline, at) : 0;

  const currentGroup = groups.find((g) => g.movement.id === currentId);
  const currentLogged = currentId ? (logged.get(currentId) ?? 0) : 0;
  const movementDone = !!currentGroup && currentLogged >= currentGroup.total;
  let setLine = "Pick a movement to begin";
  if (currentId && currentGroup) {
    setLine = movementDone
      ? `All ${currentGroup.total} sets done`
      : `Set ${currentLogged + 1} of ${currentGroup.total}`;
  } else if (currentId) setLine = `Set ${currentLogged + 1}`;

  const legend: LegendItem[] = [];
  if (layout) {
    for (const [id, ms] of layout.spent) {
      legend.push({
        movementId: id,
        name: nameOf(id),
        color: colorOf(id),
        ms,
        ghostMs: id === currentId ? layout.currentGhostMs : 0,
        state: id === currentId ? "current" : "done",
      });
    }
    for (const ghost of layout.ghosts) {
      const item = legend.find((l) => l.movementId === ghost.movementId);
      if (item) item.ghostMs = ghost.ms;
      else
        legend.push({
          movementId: ghost.movementId,
          name: nameOf(ghost.movementId),
          color: colorOf(ghost.movementId),
          ms: 0,
          ghostMs: ghost.ms,
          state: "upcoming",
        });
    }
  }

  // The ring only shows what has begun: a movement's sets appear on the inner ring once it has been started. What is
  // still ahead of the plan stays off it, as empty track, and the legend below lists it. What is drawn is then spaced
  // out so every arc is a pill with the same gap to the next.
  const started = new Set<string | null>([
    ...(timeline?.sections.map((s) => s.movementId) ?? []),
    ...props.sets.map((s) => s.movement.id),
  ]);
  // The outer ring is only the time spent. The time still expected, the current movement's included, is plain empty
  // track: `ringLayout` still counts it, so the ring fills as the workout goes.
  const shown = layout?.arcs.filter((arc) => arc.kind !== "ghost") ?? [];
  const arcs = spaceOut(shown);
  const breaks = layout?.breaks.map((b) => ({ ...b, at: remap(b.at, shown, arcs) })) ?? [];
  const current = arcs.find((arc) => arc.kind === "current");
  // The head sits on the centre of the current arc's round end.
  const headAt = current
    ? Math.max(current.start + current.length / 2, current.start + current.length - (capOf(STROKE) + GAP / 2) / 100)
    : 0;
  const head = point(headAt, R);
  const slots = slotArcs(setSlots(groups, props.sets, currentId).filter((slot) => started.has(slot.movementId)));

  // The motion of Next, played on what changed rather than on the tap, so a set logged from the list or a movement
  // picked in the sheet gets it too. See `useNextMotion`.
  const svgRef = useRef<SVGSVGElement>(null);
  const fx = useNextMotion(svgRef, { ready: !!layout, arcs, head, slots, currentId, colorOf, groups, logged });
  // When the movement changes, the arcs and the head move quickly together for a moment (`.orbit-jump`) instead of
  // over the clock's one-second tick, so the head rides the new arc as it grows and lands with the burst. It is set
  // in the same render as the change, since a transition already running keeps the timing it started with.
  const [shownId, setShownId] = useState(currentId);
  const [jumping, setJumping] = useState(false);
  if (shownId !== currentId) {
    setShownId(currentId);
    if (shownId !== null) setJumping(true);
  }
  useEffect(() => {
    if (!jumping) return;
    const id = window.setTimeout(() => setJumping(false), JUMP_MS + 100);
    return () => window.clearTimeout(id);
  }, [jumping, currentId]);
  const movesOn = props.nextSetMovesOn;
  const nextTarget = props.nextName ?? (props.nextEndsPlan ? "end of plan" : "pick one");
  const nextSetLabel = movesOn ? "Up next" : "Next set";
  const uid = useId().replace(/:/g, "");

  // A movement's name along its arc, where it fits. On the top half it follows the ring clockwise, on the bottom half
  // the other way, so it never reads upside down. It starts at the arc's start, so it stays put as the arc grows.
  const labels = arcs.flatMap((arc) => {
    const name = nameOf(arc.movementId).toUpperCase();
    const room = arc.length * CIRCUMFERENCE;
    const width = labelWidth(name);
    if (room < width + (arc.kind === "current" ? 8 : 4)) return [];
    const pad = (capOf(STROKE) + GAP) / 100 + 1.5 / CIRCUMFERENCE;
    // Which way to write it depends on where the name itself sits, near the arc's start, not on the arc's middle: an
    // arc that wraps most of the ring has its middle at the bottom and its name at the top.
    const mid = arc.start + pad + width / 2 / CIRCUMFERENCE;
    const bottom = mid > 0.25 && mid < 0.75;
    const offset = bottom ? (1 - arc.start - pad) * 100 : (arc.start + pad) * 100;
    return [{ key: arc.key, name, bottom, offset, kind: arc.kind }];
  });

  return (
    <Card role="region" className="enter enter-1 p-2 pb-4 sm:p-6" aria-label="Workout progress">
      <h3 className="eyebrow px-2 pt-2 sm:p-0">{props.title}</h3>

      <div className="@container relative mx-auto mt-1 aspect-square w-full max-w-[min(100%,calc(100dvh-13rem))] sm:mt-3 lg:max-w-[28rem]">
        <svg
          ref={svgRef}
          viewBox="0 0 120 120"
          className={cn("orbit-enter h-full w-full overflow-visible", jumping && "orbit-jump")}
          aria-hidden="true">
          <defs>
            <path
              id={`${uid}-cw`}
              d={`M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C} ${C + R} A ${R} ${R} 0 1 1 ${C} ${C - R}`}
            />
            <path
              id={`${uid}-ccw`}
              d={`M ${C} ${C - R} A ${R} ${R} 0 1 0 ${C} ${C + R} A ${R} ${R} 0 1 0 ${C} ${C - R}`}
            />
          </defs>
          <circle cx={C} cy={C} r={R} fill="none" stroke="oklch(100% 0 0 / 0.055)" strokeWidth={STROKE + 2} />
          <circle cx={C} cy={C} r={R_SETS} fill="none" stroke="oklch(100% 0 0 / 0.04)" strokeWidth={SET_STROKE + 1.5} />
          <g transform={`rotate(-90 ${C} ${C})`}>
            {current && (
              <circle
                key={`glow-${current.key}`}
                cx={C}
                cy={C}
                r={R}
                fill="none"
                pathLength={100}
                stroke={colorOf(current.movementId)}
                strokeWidth={STROKE + 3}
                strokeLinecap="round"
                className={cn("orbit-arc", paused ? "opacity-15" : "orbit-glow")}
                style={dashStyle(current, STROKE)}
              />
            )}
            {/* Every movement's time spent, in its full colour. */}
            {arcs.map((arc) => (
              <circle
                key={arc.key}
                data-arc={arc.kind}
                cx={C}
                cy={C}
                r={R}
                fill="none"
                pathLength={100}
                stroke={colorOf(arc.movementId)}
                strokeWidth={STROKE}
                strokeLinecap="round"
                className="orbit-arc"
                style={dashStyle(arc, STROKE)}
              />
            ))}
            {/* The sets: filled when logged, hollow while planned, and the next one breathing. */}
            {slots.map((slot) => {
              const hollow = slot.state !== "logged";
              const dash = dashStyle(slot, SET_STROKE, R_SETS, 0);
              return (
                <g key={slot.key}>
                  {hollow && (
                    <Hole id={`${uid}-h-${slot.key}`} radius={R_SETS} width={SET_STROKE} line={0.85} style={dash} />
                  )}
                  <circle
                    data-slot={slot.state}
                    data-slot-key={slot.key}
                    data-movement={nameOf(slot.movementId)}
                    cx={C}
                    cy={C}
                    r={R_SETS}
                    fill="none"
                    pathLength={100}
                    stroke={colorOf(slot.movementId)}
                    strokeWidth={SET_STROKE}
                    strokeLinecap="round"
                    mask={hollow ? `url(#${uid}-h-${slot.key})` : undefined}
                    className={cn("orbit-arc orbit-slot", slot.state === "next" && "clock-hold")}
                    style={dash}
                  />
                </g>
              );
            })}
            {fx.effects.map(
              (effect) => effect.kind === "comet" && <Effect key={effect.id} fx={effect} onDone={fx.done} />,
            )}
          </g>
          {labels.map((label) => (
            <text
              key={label.key}
              dominantBaseline="central"
              className="orbit-swap"
              style={{
                fontSize: LABEL_SIZE,
                fontWeight: 700,
                letterSpacing: 0.35,
                fill: "var(--color-ground)",
              }}>
              <textPath
                href={`#${uid}-${label.bottom ? "ccw" : "cw"}`}
                startOffset={`${label.offset}%`}
                textAnchor={label.bottom ? "end" : "start"}>
                {label.name}
              </textPath>
            </text>
          ))}
          {breaks.map((b) => {
            const inner = point(b.at, R - STROKE / 2 - 2.5);
            const outer = point(b.at, R + STROKE / 2 + 2.5);
            return (
              <g key={b.key} className="orbit-pop">
                <line
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke="var(--color-ground)"
                  strokeWidth={2.8}
                  strokeLinecap="round"
                />
                <line
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke="var(--color-chalk)"
                  strokeWidth={1}
                  strokeLinecap="round"
                  className={cn(b.open && "clock-hold")}
                />
              </g>
            );
          })}
          {current && (
            // Drawn at the top and turned into place, so it travels along the ring and never cuts across it.
            <g data-head="" className="orbit-head" style={{ transform: `rotate(${headAt * 360}deg)` }}>
              {!paused && (
                <circle
                  cx={C}
                  cy={C - R}
                  r={2.6}
                  fill="none"
                  stroke="var(--color-chalk)"
                  strokeWidth={0.6}
                  className="orbit-ping"
                />
              )}
              <circle cx={C} cy={C - R} r={2.6} fill="var(--color-chalk)" className={cn(paused && "clock-hold")} />
            </g>
          )}
          {fx.effects.map(
            (effect) => effect.kind !== "comet" && <Effect key={effect.id} fx={effect} onDone={fx.done} />,
          )}
        </svg>

        <div className="absolute inset-[21%] flex flex-col items-center justify-center text-center">
          <p
            key={props.complete ? "complete" : paused ? "paused" : "running"}
            className={cn("eyebrow orbit-swap", props.complete ? "text-ok" : paused && "text-accent")}>
            {props.complete ? "Plan complete" : paused ? "Paused" : "Workout time"}
          </p>
          <p
            role="timer"
            aria-label="Workout time"
            className={cn(
              "num mt-[1.5cqw] leading-none font-bold tracking-tight text-chalk font-stretch-[88%]",
              elapsed >= 3_600_000 ? "text-[13cqw]" : "text-[18cqw]",
              paused && "clock-hold",
            )}>
            {formatClock(elapsed / 1000)}
          </p>
          {layout?.plannedMs != null && (
            <p className="num mt-[1cqw] text-[max(0.75rem,3.4cqw)] text-faint">of about {minutes(layout.plannedMs)}</p>
          )}
          <p
            key={currentId ?? "warm-up"}
            data-testid="ring-movement"
            className="orbit-swap mt-[3cqw] flex max-w-full items-center gap-[1.5cqw] text-[max(1rem,5.2cqw)] font-semibold text-chalk">
            <span
              aria-hidden="true"
              className="h-[0.5em] w-[0.5em] shrink-0 rounded-full"
              style={{ background: colorOf(currentId) }}
            />
            <span className="truncate">{nameOf(currentId)}</span>
          </p>
          <p
            key={setLine}
            className={cn(
              "num orbit-swap text-[max(0.75rem,3.6cqw)]",
              movementDone ? "font-semibold text-ok" : "text-muted",
            )}>
            {setLine}
          </p>
        </div>
      </div>

      {props.complete ? (
        // The plan is done: Finish, big, and a small Add to carry on with another movement.
        <div className="enter mx-auto mt-3 flex max-w-md items-center gap-3 px-1 sm:mt-5 sm:px-0">
          <FinishButton {...props} big />
          <button
            type="button"
            onClick={props.onAdd}
            aria-label="Add another movement"
            title="Add another movement"
            className="press group flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/[0.1] text-chalk transition-colors hover:bg-white/[0.15]">
            <Plus className="h-6 w-6 transition-transform duration-300 ease-out group-hover:rotate-90 group-active:scale-75" />
          </button>
        </div>
      ) : (
        <>
          <div className="mx-auto mt-3 grid max-w-md grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-1 sm:mt-5 sm:px-0">
            <button
              type="button"
              onClick={() => {
                if (!movesOn) fx.charge();
                props.onNextSet();
              }}
              disabled={props.nextSetPending}
              aria-label={`${nextSetLabel}: ${props.nextSetDetail}`}
              className="press group flex h-14 min-w-0 items-center justify-center gap-2 rounded-full bg-white/[0.1] px-3 text-chalk transition-colors hover:bg-white/[0.15] disabled:opacity-60">
              {movesOn ? (
                <ChevronsRight
                  key="on"
                  className="icon-in h-5 w-5 shrink-0 transition-transform duration-300 ease-out group-hover:translate-x-0.5 group-active:translate-x-1.5"
                />
              ) : (
                <SkipForward
                  key="set"
                  className="h-5 w-5 shrink-0 transition-transform duration-300 ease-out group-hover:translate-x-0.5 group-active:translate-x-1.5"
                />
              )}
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span key={nextSetLabel} className="orbit-swap text-sm font-semibold whitespace-nowrap">
                  {nextSetLabel}
                </span>
                <span key={props.nextSetDetail} className="orbit-swap num max-w-full truncate text-[0.7rem] text-muted">
                  {props.nextSetDetail}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={props.onTogglePause}
              disabled={!timeline}
              aria-label={paused ? "Resume workout" : "Pause workout"}
              aria-pressed={paused}
              className={cn(
                "press relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-primary text-primary-ink shadow-[0_10px_30px_-10px_var(--color-primary)] transition-colors hover:bg-primary-strong disabled:opacity-40",
                paused && "pause-halo",
              )}>
              {paused ? (
                <Play key="play" className="icon-in h-7 w-7 translate-x-0.5" fill="currentColor" />
              ) : (
                <Pause key="pause" className="icon-in h-7 w-7" fill="currentColor" />
              )}
            </button>
            <FinishButton {...props} />
          </div>

          {/* The smaller of the two: on to the next movement. It glows once every planned set of this one is done. */}
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={props.onNext}
              aria-label={props.nextName || props.nextEndsPlan ? `Next movement: ${nextTarget}` : "Next movement"}
              className={cn(
                "press group flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-white/[0.05] pr-3.5 pl-2.5 text-xs text-muted transition-colors hover:bg-white/[0.1] hover:text-chalk",
                movementDone &&
                  (props.nextName || props.nextEndsPlan) &&
                  "next-ready bg-ok/15 text-chalk hover:bg-ok/25",
              )}>
              <ChevronsRight className="h-4 w-4 shrink-0 transition-transform duration-300 ease-out group-hover:translate-x-0.5 group-active:translate-x-1.5" />
              <span className="font-semibold whitespace-nowrap">Next movement</span>
              <span key={nextTarget} className="orbit-swap truncate text-faint">
                · {nextTarget}
              </span>
            </button>
          </div>
        </>
      )}

      {legend.length > 0 && (
        <ol
          className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-1.5 px-1 sm:mt-5"
          aria-label="Workout timeline">
          {legend.map((item) => (
            <li
              key={item.movementId ?? "warm-up"}
              data-section={item.name}
              data-state={item.state}
              className={cn(
                "enter flex min-w-0 items-center gap-2 rounded-full px-2.5 py-1 text-xs transition-colors duration-500",
                item.state === "upcoming" ? "text-faint" : "text-muted",
                item.state === "current" && "text-chalk",
              )}
              style={
                item.state === "current"
                  ? { background: `color-mix(in oklch, ${item.color} 16%, transparent)` }
                  : undefined
              }>
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full transition-opacity duration-500"
                style={
                  item.state === "upcoming"
                    ? { boxShadow: `inset 0 0 0 1.5px ${item.color}`, opacity: 0.7 }
                    : { background: item.color, opacity: item.state === "done" ? 0.6 : 1 }
                }
              />
              <span className={cn("truncate", item.state === "current" && "font-semibold")}>{item.name}</span>
              <span className="num">
                {item.ms > 0 && formatClock(item.ms / 1000)}
                {item.ms > 0 && item.ghostMs > 0 && " · "}
                {item.ghostMs > 0 && `~${minutes(item.ghostMs)}${item.ms > 0 ? " left" : ""}`}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="mx-2 mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 sm:mx-0 sm:mt-5 sm:pt-5 [&_p:first-child]:text-2xl sm:[&_p:first-child]:text-3xl">
        <Stat label="Sets" value={props.sets.length} morph />
        <Stat label="Movements" value={new Set(props.sets.map((s) => s.movement.id)).size} morph />
        <Stat label="Volume" value={volumeFormat.format(volumeOf(props.sets))} unit={weightUnit} morph />
      </div>
    </Card>
  );
}

/**
 * The mask that hollows a planned set out: everything shows except a narrower copy of its own dash, so what is left is
 * an outline `line` wide in its colour. It is in the set's own coordinates, so it follows it as it moves.
 */
function Hole(props: { id: string; radius: number; width: number; line: number; style: React.CSSProperties }) {
  const line = props.line;
  return (
    <mask id={props.id} maskUnits="userSpaceOnUse" x={-10} y={-10} width={140} height={140}>
      <rect x={-10} y={-10} width={140} height={140} fill="white" />
      <circle
        cx={C}
        cy={C}
        r={props.radius}
        fill="none"
        pathLength={100}
        stroke="black"
        strokeWidth={props.width - 2 * line}
        strokeLinecap="round"
        className="orbit-arc orbit-slot"
        style={props.style}
      />
    </mask>
  );
}

/** Finish, a chequered flag. Big once the plan is done and it is the main thing left to do. */
function FinishButton(props: { onFinish: () => void; finishing: boolean; big?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onFinish}
      disabled={props.finishing}
      aria-label={props.finishing ? "Finishing..." : "Finish Workout"}
      className={cn(
        "press flag-button group relative flex min-w-0 items-center justify-center overflow-hidden rounded-full border border-white/25 disabled:opacity-60",
        props.big ? "h-[4.5rem] flex-1" : "h-14",
      )}>
      <span aria-hidden="true" className="checkered absolute inset-0" />
      <span
        className={cn(
          "relative inline-flex items-center rounded-full bg-ground/90 font-semibold text-chalk shadow-[0_2px_10px_oklch(0%_0_0/0.5)]",
          props.big ? "gap-2 px-5 py-2.5 text-lg" : "gap-1.5 px-3 py-1.5 text-sm",
        )}>
        <Flag
          className={cn(
            "origin-bottom-left transition-transform duration-300 group-hover:-rotate-12",
            props.big ? "h-5 w-5" : "h-4 w-4",
          )}
          fill="currentColor"
        />
        {props.finishing ? "Finishing..." : props.big ? "Finish workout" : "Finish"}
      </span>
    </button>
  );
}

/** The dash of an arc as CSS variables, so a change glides and a new arc grows in (see .orbit-arc). */
function dashStyle(arc: { start: number; length: number }, width: number, radius = R, gap = GAP) {
  const { dash, offset } = roundedDash(arc, width, radius, gap);
  return { "--dash": dash, "--offset": String(offset) } as React.CSSProperties;
}

/** While paused, the ring is drawn as it was the moment the pause began. */
const pausedNow = (timeline: WorkoutTimeline) => timeline.pauses[timeline.pauses.length - 1].startedAt;

/** A short-lived flourish drawn over the ring. Fractions are of the ring, from the top, clockwise. */
type Fx =
  | {
      id: number;
      kind: "comet";
      radius: number;
      width: number;
      color: string;
      from: number;
      to: number;
      tail: number;
      duration: number;
      delay: number;
    }
  | { id: number; kind: "ripple"; x: number; y: number; color: string; size: number; delay: number }
  | { id: number; kind: "halo"; radius: number; width: number; color: string; delay: number }
  | { id: number; kind: "sparks"; x: number; y: number; color: string; count: number; reach: number; delay: number };

type FxInput = Fx extends infer T ? (T extends Fx ? Omit<T, "id"> : never) : never;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const brighten = (color: string, amount = 45) => `color-mix(in oklch, ${color}, white ${amount}%)`;

/**
 * What the ring does when the workout moves on. Nothing turns or shakes: the light travels the way the workout went.
 *
 * - Next movement: the new movement's colour bursts out of the head at once: two ripples and a spray of sparks, while
 *   the whole track glows once in that colour. The new arc then grows from there.
 * - Next set: the tap charges the set to do (it swells at once, before the server answers). When the set is logged its
 *   segment pops and throws a few sparks, then a spark runs along the inner ring to the next set, handing it on.
 * - The last planned set of a movement: every segment of that movement pops in turn, a wave round the ring, with a
 *   bigger burst at the end and the inner ring glowing once.
 *
 * All of it is skipped with reduced motion.
 */
function useNextMotion(
  svgRef: React.RefObject<SVGSVGElement | null>,
  state: {
    /** The ring has a clock and is drawn. */
    ready: boolean;
    /** The arcs as drawn, after `spaceOut`. */
    arcs: Arc[];
    head: { x: number; y: number };
    slots: ReturnType<typeof slotArcs>;
    currentId: string | null;
    colorOf: (id: string | null) => string;
    groups: PlannedGroup[];
    logged: Map<string, number>;
  },
) {
  const [effects, setEffects] = useState<Fx[]>([]);
  const seq = useRef(0);
  const prev = useRef<{ currentId: string | null; logged: Set<string> } | null>(null);

  const play = (...items: FxInput[]) => {
    setEffects((list) => [...list, ...items.map((item) => ({ ...item, id: ++seq.current }) as Fx)]);
  };
  const slotEl = (selector: string) => svgRef.current?.querySelector<SVGCircleElement>(selector) ?? null;
  const pop = (el: SVGCircleElement | null, delay = 0, swell = 2) =>
    el?.animate(
      [
        { strokeWidth: SET_STROKE, strokeOpacity: 1 },
        { strokeWidth: SET_STROKE * swell, strokeOpacity: 1, offset: 0.3 },
        { strokeWidth: SET_STROKE, strokeOpacity: 1 },
      ],
      { duration: 620, delay, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );

  const { ready, arcs, head, slots, currentId, colorOf, groups, logged } = state;
  const current = arcs.find((arc) => arc.kind === "current") ?? null;
  const loggedKeys = slots.filter((slot) => slot.state === "logged").map((slot) => slot.key);
  const signature = `${currentId}|${current?.key}|${loggedKeys.join(",")}`;

  useEffect(() => {
    // Before the clock starts there is no ring to play on; remember where things are once it does.
    if (!ready) return;
    const before = prev.current;
    prev.current = { currentId, logged: new Set(loggedKeys) };
    if (!before || prefersReducedMotion()) return;

    // A new movement: the head glides along the ring onto it (see `.orbit-jump`) and it bursts where the head lands.
    // Nothing runs back over the movement just left, which read as going back to it.
    if (before.currentId !== currentId && current) {
      const color = colorOf(currentId);
      const land = JUMP_MS * 0.7;
      play(
        { kind: "halo", radius: R, width: STROKE + 4, color, delay: land },
        { kind: "ripple", x: head.x, y: head.y, color, size: 4, delay: land },
        { kind: "ripple", x: head.x, y: head.y, color: brighten(color), size: 4, delay: land + 170 },
        { kind: "sparks", x: head.x, y: head.y, color, count: 14, reach: 17, delay: land },
      );
    }

    // Sets just logged.
    for (const slot of slots) {
      if (slot.state !== "logged" || before.logged.has(slot.key)) continue;
      const color = colorOf(slot.movementId);
      const mid = point(slot.start + slot.length / 2, R_SETS);
      const own = slots.filter((s) => s.movementId === slot.movementId);
      const group = groups.find((g) => g.movement.id === slot.movementId);
      const finished = !!group && (logged.get(slot.movementId) ?? 0) === group.total;

      pop(slotEl(`[data-slot-key="${slot.key}"]`));
      play(
        { kind: "ripple", x: mid.x, y: mid.y, color, size: 2.6, delay: 0 },
        { kind: "sparks", x: mid.x, y: mid.y, color, count: 9, reach: 10, delay: 0 },
      );

      if (finished) {
        // A wave over the movement's sets, ending in a bigger burst on the last one.
        own.forEach((s, i) => pop(slotEl(`[data-slot-key="${s.key}"]`), 260 + i * 80, 2.4));
        const last = own[own.length - 1];
        const end = point(last.start + last.length / 2, R_SETS);
        play(
          { kind: "halo", radius: R_SETS, width: SET_STROKE + 3, color, delay: 260 + own.length * 80 },
          { kind: "ripple", x: end.x, y: end.y, color: brighten(color), size: 3.4, delay: 260 + own.length * 80 },
          { kind: "sparks", x: end.x, y: end.y, color, count: 16, reach: 16, delay: 260 + own.length * 80 },
        );
        continue;
      }
      const next = own.find((s) => s.state === "next") ?? own.find((s) => s.state === "planned");
      if (next && next.start > slot.start) {
        play({
          kind: "comet",
          radius: R_SETS,
          width: SET_STROKE * 0.75,
          color: brighten(color, 55),
          from: slot.start + slot.length / 2,
          to: next.start + next.length / 2,
          tail: 2.4,
          duration: 420,
          delay: 160,
        });
      }
    }
    // Only when what is on the ring changes, not on every tick of the clock.
  }, [signature, ready]);

  return {
    effects,
    done: (id: number) => setEffects((list) => list.filter((effect) => effect.id !== id)),
    /** The tap on Next set: the set to do swells at once, so the tap is felt before the set is saved. */
    charge: () => {
      if (prefersReducedMotion()) return;
      slotEl('[data-slot="next"]')?.animate(
        [{ strokeWidth: SET_STROKE * 1.9, strokeOpacity: 1 }, { strokeWidth: SET_STROKE }],
        { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    },
  };
}

/** Where spark `i` flies: spread evenly with a little turn each, so the spray never looks like a clock face. */
function sparkPath(fx: { count: number; reach: number }, i: number) {
  const angle = (i / fx.count) * 2 * Math.PI + (i % 2 ? 0.35 : -0.2);
  const reach = fx.reach * (i % 3 === 0 ? 1 : i % 3 === 1 ? 0.7 : 0.85);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { cos, sin, dx: cos * reach, dy: sin * reach };
}

/** One flourish, played with the Web Animations API when it mounts and removed when it ends. */
function Effect({ fx, onDone }: { fx: Fx; onDone: (id: number) => void }) {
  const ref = useRef<SVGGElement>(null);

  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    const easing = "cubic-bezier(0.2, 0.8, 0.2, 1)";
    const anims: Animation[] = [];
    const parts = [...g.children] as SVGElement[];

    if (fx.kind === "comet") {
      const from = fx.from * 100;
      const to = Math.max(from, fx.to * 100 - fx.tail);
      for (const part of parts) {
        anims.push(
          part.animate(
            [
              { strokeDashoffset: -from, opacity: 0 },
              { opacity: 1, offset: 0.15 },
              { opacity: 1, offset: 0.75 },
              { strokeDashoffset: -to, opacity: 0 },
            ],
            { duration: fx.duration, delay: fx.delay, easing: "cubic-bezier(0.45, 0, 0.25, 1)" },
          ),
        );
      }
    } else if (fx.kind === "ripple") {
      anims.push(
        parts[0].animate(
          [
            { transform: "scale(1)", strokeWidth: 2, opacity: 1 },
            { transform: "scale(3.8)", strokeWidth: 0.2, opacity: 0 },
          ],
          { duration: 760, delay: fx.delay, easing },
        ),
      );
    } else if (fx.kind === "halo") {
      anims.push(
        parts[0].animate(
          [
            { strokeWidth: fx.width, opacity: 0 },
            { strokeWidth: fx.width * 1.5, opacity: 0.45, offset: 0.25 },
            { strokeWidth: fx.width * 2, opacity: 0 },
          ],
          { duration: 900, delay: fx.delay, easing },
        ),
      );
    } else {
      parts.forEach((part, i) => {
        const { dx, dy } = sparkPath(fx, i);
        anims.push(
          part.animate(
            [
              { transform: "translate(0px, 0px)", opacity: 1 },
              { transform: `translate(${dx * 0.75}px, ${dy * 0.75}px)`, opacity: 1, offset: 0.5 },
              { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 },
            ],
            { duration: 560 + (i % 3) * 90, delay: fx.delay, easing },
          ),
        );
      });
    }

    let alive = true;
    Promise.all(anims.map((a) => a.finished))
      .then(() => alive && onDone(fx.id))
      .catch(() => {});
    return () => {
      alive = false;
      for (const a of anims) a.cancel();
    };
    // Each flourish plays once, for the life of its element.
  }, []);

  if (fx.kind === "comet") {
    const dash = `${fx.tail} ${100 - fx.tail}`;
    const base = { cx: C, cy: C, r: fx.radius, fill: "none", pathLength: 100, strokeLinecap: "round" as const };
    return (
      <g ref={ref} data-fx="comet" pointerEvents="none">
        <circle
          {...base}
          stroke={fx.color}
          strokeWidth={fx.width * 2.2}
          strokeDasharray={dash}
          opacity={0}
          style={{ filter: "blur(1.5px)" }}
        />
        <circle {...base} stroke={fx.color} strokeWidth={fx.width} strokeDasharray={dash} opacity={0} />
      </g>
    );
  }
  if (fx.kind === "ripple") {
    return (
      <g ref={ref} data-fx="ripple" pointerEvents="none">
        <circle
          cx={fx.x}
          cy={fx.y}
          r={fx.size}
          fill="none"
          stroke={fx.color}
          strokeWidth={2}
          opacity={0}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        />
      </g>
    );
  }
  if (fx.kind === "halo") {
    return (
      <g ref={ref} data-fx="halo" pointerEvents="none">
        <circle
          cx={C}
          cy={C}
          r={fx.radius}
          fill="none"
          stroke={fx.color}
          strokeWidth={fx.width}
          opacity={0}
          style={{ filter: "blur(2.5px)" }}
        />
      </g>
    );
  }
  return (
    <g ref={ref} data-fx="sparks" pointerEvents="none">
      {Array.from({ length: fx.count }, (_, i) => {
        const { cos, sin } = sparkPath(fx, i);
        // A short streak pointing the way it flies, longer for every third.
        const length = i % 3 === 0 ? 4 : 2.6;
        return (
          <line
            key={i}
            x1={fx.x + cos * 1.5}
            y1={fx.y + sin * 1.5}
            x2={fx.x + cos * (1.5 + length)}
            y2={fx.y + sin * (1.5 + length)}
            stroke={brighten(fx.color, i % 2 ? 75 : 35)}
            strokeWidth={i % 3 === 0 ? 1.3 : 0.9}
            strokeLinecap="round"
            opacity={0}
          />
        );
      })}
    </g>
  );
}
