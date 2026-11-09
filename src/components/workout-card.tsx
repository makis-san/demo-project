import { Link } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MovementThumb } from "@/components/movement-figure/movement-thumb";
import type { MuscleGroup } from "@/lib/muscles";
import { cn } from "@/lib/utils";

export const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const weekdayShort = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type WorkoutSummary = {
  id: string;
  name: string;
  exerciseCount: number;
  setCount: number;
  movements: { name: string; primaryMuscles: MuscleGroup[]; secondaryMuscles: MuscleGroup[] }[];
  weekdays?: number[];
  doneToday?: boolean;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A saved workout as a card: the body parts it works as small images, its name, how big it is, and where it is the
 * workout of the day. Opening it goes to the start screen, which shows the plan and has the Start button, so nothing
 * begins from a tap on a card.
 */
export function WorkoutCard({
  workout,
  actions,
  className,
}: {
  workout: WorkoutSummary;
  /** Buttons on the right, for example Edit. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("relative flex items-center gap-4 p-3 sm:p-4", className)} data-workout={workout.name}>
      <div className="flex shrink-0 -space-x-3" aria-hidden="true">
        {workout.movements.slice(0, 3).map((m, i) => (
          <MovementThumb
            key={i}
            primary={m.primaryMuscles}
            secondary={m.secondaryMuscles}
            className={cn("h-10 w-10 rounded-xl border-2 border-ground sm:h-12 sm:w-12", i === 2 && "hidden sm:block")}
          />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <Link
          to="/start-workout"
          search={{ preset: workout.id, from: undefined }}
          className="block truncate text-base font-semibold tracking-tight text-chalk font-stretch-[108%] after:absolute after:inset-0 after:rounded-panel">
          {workout.name}
        </Link>
        <p className="num truncate text-xs text-muted">
          {plural(workout.exerciseCount, "movement")} · {plural(workout.setCount, "set")}
        </p>
        {workout.weekdays && workout.weekdays.length > 0 && (
          <p className="truncate text-xs text-faint" aria-label="Workout of the day on">
            {workout.weekdays.map((d) => weekdayShort[d - 1]).join(", ")}
          </p>
        )}
      </div>
      {workout.doneToday && (
        <span className="relative inline-flex shrink-0 items-center gap-1 rounded-full bg-ok/15 px-2.5 py-1 text-xs font-semibold text-ok">
          <Check className="h-3.5 w-3.5" aria-hidden="true" /> Done today
        </span>
      )}
      <div className="relative z-10 flex shrink-0 items-center gap-1">{actions}</div>
      {!actions && <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />}
    </Card>
  );
}
