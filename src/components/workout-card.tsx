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
 * A saved workout as a card: the body parts it works as small images, its name, how big it is, and, when `weekdays` is
 * given, a row of seven letters (M T W T F S S) with the days it is planned for lit. Opening it goes to the start
 * screen, which shows the plan and has the Start button, so nothing begins from a tap on a card.
 */
export function WorkoutCard({
  workout,
  actions,
  topAction,
  className,
}: {
  workout: WorkoutSummary;
  /** Buttons on the right, for example Start. */
  actions?: React.ReactNode;
  /** A small button at the end of the title row, for example Edit, when the card has a row of planned days. */
  topAction?: React.ReactNode;
  className?: string;
}) {
  const planned = workout.weekdays;
  const actionRow = <div className="relative z-10 flex shrink-0 items-center gap-1">{actions}</div>;
  return (
    <Card className={cn("relative space-y-3 p-3 sm:p-4", className)} data-workout={workout.name}>
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 -space-x-3" aria-hidden="true">
          {workout.movements.slice(0, 3).map((m, i) => (
            <MovementThumb
              key={i}
              primary={m.primaryMuscles}
              secondary={m.secondaryMuscles}
              className={cn(
                "h-10 w-10 rounded-xl border-2 border-ground sm:h-12 sm:w-12",
                i === 2 && "hidden sm:block",
              )}
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
        </div>
        {workout.doneToday && (
          <span className="relative inline-flex shrink-0 items-center gap-1 rounded-full bg-ok/15 px-2.5 py-1 text-xs font-semibold text-ok">
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Done today
          </span>
        )}
        {planned && topAction && <div className="relative z-10 shrink-0">{topAction}</div>}
        {!planned && actions && actionRow}
        {!planned && !actions && <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />}
      </div>
      {planned && (
        <div className="flex items-center justify-between gap-3">
          <ol className="flex gap-1" aria-label="Planned days">
            {weekdayNames.map((name, i) => {
              const on = planned.includes(i + 1);
              return (
                <li
                  key={name}
                  aria-label={on ? `${name}, planned` : name}
                  data-planned={on}
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full text-xs font-semibold",
                    on ? "bg-primary text-primary-ink" : "bg-well text-faint",
                  )}>
                  <span aria-hidden="true">{name[0]}</span>
                </li>
              );
            })}
          </ol>
          {actionRow}
        </div>
      )}
    </Card>
  );
}
