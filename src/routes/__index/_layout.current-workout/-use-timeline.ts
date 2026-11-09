import { useCallback, useEffect, useRef, useState } from "react";
import { saveWorkoutTimelineServerFn } from "@/lib/workouts.server";
import { storage } from "@/lib/use-now";
import { close, newTimeline, parseTimeline, type WorkoutTimeline } from "@/lib/workout-timeline";

const timelineKey = "setlist.timeline";
/** How long the browser waits after a change before it sends the timeline, so a burst of taps is one request. */
const syncDelayMs = 600;

type Stored = { workoutId: string; timeline: WorkoutTimeline };

function readLocal(workoutId: string) {
  try {
    const stored = JSON.parse(storage.get(timelineKey) ?? "null") as Stored | null;
    return stored?.workoutId === workoutId ? parseTimeline(stored.timeline) : null;
  } catch {
    return null;
  }
}

const writeLocal = (workoutId: string, timeline: WorkoutTimeline) =>
  storage.set(timelineKey, JSON.stringify({ workoutId, timeline } satisfies Stored));

const newer = (a: WorkoutTimeline | null, b: WorkoutTimeline | null) =>
  !a ? b : !b ? a : a.updatedAt >= b.updatedAt ? a : b;

/**
 * The timeline of the open workout, local first. A change shows at once, is saved to localStorage in the same tap, and
 * goes to the server a moment later. On load the newer of the local and the server copy wins, so a reload, a lost
 * connection or a second device all pick up where the workout is. A send that fails is not retried in a loop: the
 * local copy is newer, so the next change or the next load sends it.
 *
 * One localStorage key holds the timeline of one workout, so nothing piles up from workouts that are done.
 */
export function useWorkoutTimeline(
  workout: { id: string; startedAt: Date | string; timeline: WorkoutTimeline | null } | null,
  /** The movement the first section is for when there is no timeline yet: the plan's first, or none. */
  firstMovementId: string | null,
) {
  const workoutId = workout?.id ?? null;
  const [timeline, setTimeline] = useState<WorkoutTimeline | null>(null);
  const latest = useRef<WorkoutTimeline | null>(null);
  const pendingSync = useRef<number | undefined>(undefined);
  // What the effect below reads once per workout, when it loads. The workout is refetched after every set, but those
  // copies of the timeline are older than the one in hand, so they are not read again.
  const initial = { server: workout?.timeline ?? null, startedAt: workout?.startedAt, firstMovementId };
  const initialRef = useRef(initial);
  initialRef.current = initial;

  const adopt = useCallback((id: string, next: WorkoutTimeline) => {
    latest.current = next;
    setTimeline(next);
    writeLocal(id, next);
  }, []);

  const send = useCallback(
    (id: string, next: WorkoutTimeline) => {
      window.clearTimeout(pendingSync.current);
      pendingSync.current = undefined;
      saveWorkoutTimelineServerFn({ data: { workoutId: id, timeline: next } })
        .then((result) => {
          // The server had a newer copy, changed on another device: show that one.
          if (result.success && latest.current && result.timeline.updatedAt > latest.current.updatedAt) {
            adopt(id, result.timeline);
          }
        })
        .catch(() => {
          // Offline or the server refused. The local copy stays newer and is sent with the next change or load.
        });
    },
    [adopt],
  );

  useEffect(() => {
    if (!workoutId) {
      latest.current = null;
      setTimeline(null);
      return;
    }
    const { server, startedAt, firstMovementId } = initialRef.current;
    const chosen =
      newer(readLocal(workoutId), server) ?? newTimeline(new Date(startedAt ?? Date.now()).getTime(), firstMovementId);
    adopt(workoutId, chosen);
    if (!server || chosen.updatedAt > server.updatedAt) send(workoutId, chosen);
  }, [workoutId, adopt, send]);

  // A change made just before the tab is hidden or closed is sent right away instead of after the delay.
  // Leaving the page inside the app sends a change still waiting, since the page is gone before the delay ends. A
  // reload or a closed tab does not send it: a request started while the page unloads is cut off half way, and the
  // local copy is sent on the next load anyway, because it is newer.
  useEffect(() => {
    if (!workoutId) return;
    return () => {
      if (pendingSync.current !== undefined && latest.current) send(workoutId, latest.current);
    };
  }, [workoutId, send]);

  /** Applies a change from `workout-timeline.ts`. A change that returns the same timeline saves nothing. */
  const update = useCallback(
    (change: (timeline: WorkoutTimeline, now: number) => WorkoutTimeline) => {
      const current = latest.current;
      if (!workoutId || !current) return;
      const next = change(current, Date.now());
      if (next === current) return;
      adopt(workoutId, next);
      window.clearTimeout(pendingSync.current);
      pendingSync.current = window.setTimeout(() => latest.current && send(workoutId, latest.current), syncDelayMs);
    },
    [workoutId, adopt, send],
  );

  /** The closed timeline to send with Finish. It cancels the pending send, since Finish carries it. */
  const finish = useCallback(() => {
    window.clearTimeout(pendingSync.current);
    pendingSync.current = undefined;
    return latest.current && close(latest.current, Date.now());
  }, []);

  /** Forgets the local copy once the workout is complete. */
  const clear = useCallback(() => storage.set(timelineKey, null), []);

  return { timeline, update, finish, clear };
}
