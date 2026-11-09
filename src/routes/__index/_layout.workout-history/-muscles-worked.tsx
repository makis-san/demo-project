import { useSuspenseQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { BodyMap } from "@/components/movement-figure/body-map";
import { muscleGroups, muscleLabels, type MuscleGroup } from "@/lib/muscles";
import { formatDay } from "../_layout.current-workout/-workout-parts";
import { muscleLoadQueryOptions } from "./-queries/workout-history";

const setsFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/**
 * Which muscles the last 7 days trained: the body map tinted by load and the groups with their set counts.
 * A primary muscle of a set counts 1 set and a secondary one counts half, worked out in one SQL query.
 */
export function MusclesWorked({ timeZone }: { timeZone: string }) {
  const { data } = useSuspenseQuery(muscleLoadQueryOptions(timeZone));
  const sets = new Map(data.muscles.map((m) => [m.muscle, m.sets]));
  const most = Math.max(0, ...data.muscles.map((m) => m.sets));
  // Even the least trained group is visibly tinted, and the busiest is fully hot.
  const levels: Partial<Record<MuscleGroup, number>> = {};
  for (const { muscle, sets: n } of data.muscles) levels[muscle] = Math.max(0.2, n / most);
  const untrained = muscleGroups.filter((m) => !sets.has(m));

  return (
    <Card className="enter enter-1 p-3 sm:p-5">
      <div className="space-y-1 px-2 pt-2 pb-4 sm:px-0 sm:pt-0">
        <p className="eyebrow">
          Last 7 days · {formatDay(data.from)} to {formatDay(data.today)}
        </p>
        <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">Muscles worked</h2>
      </div>
      {data.totalSets === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
          No completed workouts in the last 7 days. Finish one and the muscles it trained show up here.
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-center">
          <BodyMap levels={levels} label="Muscles worked in the last 7 days" />
          <div className="space-y-3">
            {data.muscles.length === 0 ? (
              <p className="text-sm text-muted">The movements you did have no muscles set, so nothing is counted.</p>
            ) : (
              <ul className="space-y-2" aria-label="Sets per muscle group">
                {data.muscles.map(({ muscle, sets: n }) => (
                  <li
                    key={muscle}
                    data-muscle={muscle}
                    className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3">
                    <span className="text-sm text-chalk">{muscleLabels[muscle]}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${(n / most) * 100}%` }}
                      />
                    </span>
                    <span className="num text-right text-sm font-semibold text-chalk">{setsFormat.format(n)}</span>
                  </li>
                ))}
              </ul>
            )}
            {untrained.length > 0 && data.muscles.length > 0 && (
              <p className="text-xs text-faint">Not trained: {untrained.map((m) => muscleLabels[m]).join(", ")}.</p>
            )}
            {data.uncountedSets > 0 && (
              <p className="text-xs text-faint">
                {data.uncountedSets} {data.uncountedSets === 1 ? "set was" : "sets were"} on movements with no muscles
                set, so they are not counted.
              </p>
            )}
            <p className="text-xs text-faint">
              A primary muscle counts 1 set per set done, a secondary muscle counts half.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
