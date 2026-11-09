import { z } from "zod";

/**
 * The timeline of a workout, behind the ring on the current workout page. It is a list of sections, one each time the
 * current movement changed, and a list of pauses. Times are epoch milliseconds from the browser's clock.
 *
 * Only the time outside pauses counts: the workout clock, the length of each section and the ring all stop while the
 * workout is paused. A pause is a break, drawn on the ring as a thin line of a fixed size, not as an arc.
 *
 * The browser owns it while the workout is open. It saves it to localStorage on every change and then to the server,
 * and on load the copy with the newer `updatedAt` wins. So the ring answers at once, and it is still there after a
 * reload, offline, or on another device.
 */

const maxEntries = 500;
const millis = z.number().int().nonnegative();

export const workoutTimelineSchema = z.object({
  version: z.literal(1),
  updatedAt: millis,
  sections: z
    .array(z.object({ movementId: z.string().max(100).nullable(), startedAt: millis, endedAt: millis.nullable() }))
    .min(1)
    .max(maxEntries),
  pauses: z.array(z.object({ startedAt: millis, endedAt: millis.nullable() })).max(maxEntries),
});

export type WorkoutTimeline = z.infer<typeof workoutTimelineSchema>;
export type TimelineSection = WorkoutTimeline["sections"][number];

/** Going back to the movement just before within this time undoes a mistap: that section carries on. */
const mistapMs = 3000;

export function newTimeline(startedAt: number, movementId: string | null, now = Date.now()): WorkoutTimeline {
  return { version: 1, updatedAt: now, sections: [{ movementId, startedAt, endedAt: null }], pauses: [] };
}

/** Reads a stored timeline, or null when it is missing or not one. */
export function parseTimeline(value: unknown): WorkoutTimeline | null {
  const parsed = workoutTimelineSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const currentSection = (timeline: WorkoutTimeline) => timeline.sections[timeline.sections.length - 1];

export const isPaused = (timeline: WorkoutTimeline) => timeline.pauses.at(-1)?.endedAt === null;

/** The time between `from` and `to` that was not paused. */
export function activeMs(timeline: WorkoutTimeline, from: number, to: number) {
  if (to <= from) return 0;
  let paused = 0;
  for (const pause of timeline.pauses) {
    const start = Math.max(from, pause.startedAt);
    const end = Math.min(to, pause.endedAt ?? to);
    if (end > start) paused += end - start;
  }
  return to - from - paused;
}

/** The workout clock: the time since the first section began, without the pauses. */
export const elapsedMs = (timeline: WorkoutTimeline, now: number) =>
  activeMs(timeline, timeline.sections[0].startedAt, now);

export const sectionMs = (timeline: WorkoutTimeline, section: TimelineSection, now: number) =>
  activeMs(timeline, section.startedAt, section.endedAt ?? now);

/**
 * Makes `movementId` the current movement. The open section ends now and a new one begins, unless it is already that
 * movement. Every movement moved on from keeps its section, however short, so the ring shows each one. The one exception
 * is a mistap: going straight back to the movement before within a few seconds carries on with that section.
 */
export function switchTo(timeline: WorkoutTimeline, movementId: string, now: number): WorkoutTimeline {
  const current = currentSection(timeline);
  if (current.movementId === movementId) return timeline;
  const before = timeline.sections.slice(0, -1);
  const previous = before.at(-1);
  if (previous?.movementId === movementId && sectionMs(timeline, current, now) < mistapMs) {
    return { ...timeline, updatedAt: now, sections: [...before.slice(0, -1), { ...previous, endedAt: null }] };
  }
  return {
    ...timeline,
    updatedAt: now,
    sections: [...before, { ...current, endedAt: now }, { movementId, startedAt: now, endedAt: null }],
  };
}

export function pause(timeline: WorkoutTimeline, now: number): WorkoutTimeline {
  if (isPaused(timeline)) return timeline;
  return { ...timeline, updatedAt: now, pauses: [...timeline.pauses, { startedAt: now, endedAt: null }] };
}

export function resume(timeline: WorkoutTimeline, now: number): WorkoutTimeline {
  if (!isPaused(timeline)) return timeline;
  const pauses = timeline.pauses.slice(0, -1);
  const last = timeline.pauses[timeline.pauses.length - 1];
  // A pause shorter than a second was a mistap: drop it, so the ring has no break for it.
  const kept = now - last.startedAt < 1000 ? pauses : [...pauses, { ...last, endedAt: now }];
  return { ...timeline, updatedAt: now, pauses: kept };
}

/** Ends the open section and any open pause, when the workout is finished. */
export function close(timeline: WorkoutTimeline, now: number): WorkoutTimeline {
  const resumed = resume(timeline, now);
  const sections = resumed.sections.map((s) => (s.endedAt === null ? { ...s, endedAt: now } : s));
  return { ...resumed, updatedAt: now, sections };
}
