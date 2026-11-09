import { useCallback, useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import { Morph } from "@/components/morph";
import { buzz, formatClock, storage, useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const restKey = "setlist.rest";
const restSecondsKey = "setlist.rest.seconds";
const restPresets = [45, 60, 90, 120, 180, 0] as const;
const defaultRestSeconds = 90;

type Rest = { workoutId: string; startedAt: number; endsAt: number };

/**
 * The rest between sets. It starts when a set is logged and counts down to a time stored as a timestamp, so it
 * stays right when the phone sleeps or the page reloads. It is kept in localStorage, per workout: it is a
 * reminder on this device, not workout data, so it never goes to the server.
 */
export function useRestTimer(workoutId: string | null) {
  const [rest, setRest] = useState<Rest | null>(null);
  const [seconds, setSecondsState] = useState(defaultRestSeconds);

  useEffect(() => {
    const savedSeconds = Number(storage.get(restSecondsKey));
    if (storage.get(restSecondsKey) !== null && Number.isFinite(savedSeconds)) setSecondsState(savedSeconds);
    try {
      const saved = JSON.parse(storage.get(restKey) ?? "null") as Rest | null;
      // A rest from another workout, or one that ended long ago, is stale.
      if (saved && saved.workoutId === workoutId && saved.endsAt > Date.now() - 10_000) setRest(saved);
    } catch {
      storage.set(restKey, null);
    }
  }, [workoutId]);

  const save = useCallback((next: Rest | null) => {
    setRest(next);
    storage.set(restKey, next && JSON.stringify(next));
  }, []);

  const start = useCallback(() => {
    if (!workoutId || seconds <= 0) return;
    const now = Date.now();
    save({ workoutId, startedAt: now, endsAt: now + seconds * 1000 });
  }, [workoutId, seconds, save]);

  const adjust = useCallback(
    (deltaSeconds: number) => {
      if (!rest) return;
      // Never below now: taking 15 s off a rest with 5 s left ends it.
      save({ ...rest, endsAt: Math.max(Date.now(), rest.endsAt + deltaSeconds * 1000) });
    },
    [rest, save],
  );

  const stop = useCallback(() => save(null), [save]);

  const cycleSeconds = useCallback(() => {
    setSecondsState((current) => {
      const i = restPresets.indexOf(current as (typeof restPresets)[number]);
      const next = restPresets[(i + 1) % restPresets.length];
      storage.set(restSecondsKey, String(next));
      return next;
    });
  }, []);

  return { rest, seconds, start, adjust, stop, cycleSeconds };
}

export type RestTimerState = ReturnType<typeof useRestTimer>;

/** Rest length as a button that cycles through the presets: 0:45, 1:00, 1:30, 2:00, 3:00, off. */
export function RestLengthButton({ timer }: { timer: RestTimerState }) {
  return (
    <button
      type="button"
      onClick={timer.cycleSeconds}
      className="press inline-flex h-11 items-center gap-2 rounded-full border border-line bg-white/[0.04] px-4 text-sm text-muted hover:border-line-strong hover:text-chalk">
      <Timer className="h-4 w-4 text-accent" />
      <span>
        Rest <span className="num font-semibold text-chalk">{timer.seconds ? formatClock(timer.seconds) : "off"}</span>
      </span>
    </button>
  );
}

const ring = 2 * Math.PI * 19;

/**
 * The countdown, floating above the dock on a phone and in the corner on a desktop, where a thumb or a glance
 * finds it between sets. It buzzes the phone when the rest is over, then puts itself away.
 */
export function RestTimerPill({ timer }: { timer: RestTimerState }) {
  const { rest, adjust, stop } = timer;
  const now = useNow(250, rest !== null);
  const remaining = rest && now !== null ? Math.max(0, (rest.endsAt - now) / 1000) : null;
  const total = rest ? (rest.endsAt - rest.startedAt) / 1000 : 1;
  const over = remaining !== null && remaining <= 0;

  // Buzz once when the countdown reaches zero while the page is open, not when a finished rest is reloaded.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (remaining === null) return;
    if (remaining > 0) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      buzz([180, 90, 180]);
    }
  }, [remaining]);

  // A finished rest stays for a few seconds, then goes.
  useEffect(() => {
    if (!over) return;
    const id = window.setTimeout(stop, 8000);
    return () => window.clearTimeout(id);
  }, [over, stop]);

  if (!rest || remaining === null) return null;
  const progress = over ? 1 : 1 - remaining / Math.max(total, 1);

  return (
    <div
      className={cn(
        "glass glass-strong enter fixed inset-x-3 z-30 flex items-center gap-3 rounded-[1.5rem] py-2 pr-2 pl-2.5",
        "bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5.25rem)] md:inset-x-auto md:right-6 md:bottom-6 md:w-[22rem]",
        over && "border-ok/50",
      )}>
      <div className="relative grid h-12 w-12 shrink-0 place-items-center">
        <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle cx="22" cy="22" r="19" fill="none" strokeWidth="3" className="stroke-white/10" />
          <circle
            cx="22"
            cy="22"
            r="19"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={ring}
            strokeDashoffset={ring * (1 - progress)}
            className={cn(
              "transition-[stroke-dashoffset] duration-300 ease-linear",
              over ? "stroke-ok" : "stroke-primary",
            )}
          />
        </svg>
        <Timer className={cn("h-4 w-4", over ? "text-ok" : "text-muted")} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="eyebrow">{over ? "Rest over" : "Resting"}</p>
        {over ? (
          <p className="text-lg font-semibold text-ok font-stretch-[112%]">Next set</p>
        ) : (
          <p aria-hidden="true" className="text-2xl leading-tight font-bold text-chalk font-stretch-[88%]">
            <Morph value={formatClock(Math.ceil(remaining))} />
          </p>
        )}
      </div>
      {/* Announced once, when the rest ends. The ticking seconds stay out of the screen reader's way. */}
      <p className="sr-only" role="status">
        {over ? "Rest over. Time for the next set." : ""}
      </p>
      {!over && (
        <>
          <PillButton onClick={() => adjust(-15)}>−15s</PillButton>
          <PillButton onClick={() => adjust(15)}>+15s</PillButton>
        </>
      )}
      <PillButton onClick={stop} strong={over ? "go" : true}>
        {over ? "Done" : "Skip"}
      </PillButton>
    </div>
  );
}

function PillButton({
  children,
  onClick,
  strong,
}: {
  children: string;
  onClick: () => void;
  /** true: the red main action. "go": teal, for the moment rest is over. */
  strong?: boolean | "go";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "press num h-11 min-w-11 shrink-0 rounded-full px-3 text-sm font-semibold",
        strong
          ? "bg-primary text-primary-ink hover:bg-primary-strong"
          : "bg-white/[0.07] text-chalk hover:bg-white/[0.12]",
      )}>
      {children}
    </button>
  );
}
