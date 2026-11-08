import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, type ChartPoint } from "@/components/ui/line-chart";
import { Select } from "@/components/ui/select";
import { chartDate, formatDate, formatTime, shortDate } from "@/lib/dates";
import { progressionQueryOptions } from "./-queries/workout-history";
import { weightUnit } from "@/lib/units";

// The README gives max weight "on a given day" and the totals "in a workout", so the chart has a point per day
// for the first and a point per workout for the other two.
const metrics = {
  maxWeight: { label: "Max weight", unit: weightUnit, minTickStep: 0 },
  totalReps: { label: "Total reps", unit: "reps", minTickStep: 1 },
  totalVolume: { label: "Total volume", unit: weightUnit, minTickStep: 0 },
} as const satisfies Record<string, { label: string; unit: string; minTickStep: number }>;

type Metric = keyof typeof metrics;

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * Plots one metric for one movement from completed workouts: a point per day for max weight, a point per workout
 * for total reps and total volume.
 */
export function ProgressionChart({
  movements,
  timeZone,
}: {
  movements: { id: string; name: string }[];
  timeZone: string;
}) {
  const [movementId, setMovementId] = useState(movements[0]?.id ?? "");
  const [metric, setMetric] = useState<Metric>("maxWeight");
  const movement = movements.find((m) => m.id === movementId) ?? movements[0];

  // No placeholder data: while another movement loads, the old movement's chart
  // would sit under the new movement's name.
  const { data } = useQuery(progressionQueryOptions(movement.id, timeZone));

  const { label, unit, minTickStep } = metrics[metric];
  const format = (value: number) => `${numberFormat.format(value)} ${unit}`;
  // A day is a plain date already in the user's timezone, so read it as UTC to format it as that same date.
  // A workout is a real moment, so it is formatted in the user's timezone.
  let points: ChartPoint[] = [];
  let xTimeZone = timeZone;
  if (data && metric === "maxWeight") {
    xTimeZone = "UTC";
    points = data.days.map((row) => {
      const x = Date.parse(`${row.day}T00:00:00Z`);
      return { x, y: row.maxWeight, title: `${format(row.maxWeight)} on ${formatDate(x, "UTC", shortDate)}` };
    });
  } else if (data && metric !== "maxWeight") {
    // Two workouts on one day look alike in a tooltip, so those get the time of day as well.
    const perDay = new Map<string, number>();
    for (const row of data.workouts) perDay.set(row.day, (perDay.get(row.day) ?? 0) + 1);
    points = data.workouts.map((row) => {
      const x = row.completedAt.getTime();
      const y = row[metric];
      const sameDay = (perDay.get(row.day) ?? 0) > 1;
      const when = `${formatDate(x, timeZone, shortDate)}${sameDay ? ` at ${formatTime(x, timeZone)}` : ""}`;
      return { x, y, title: `${format(y)} on ${when}` };
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Progression</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Select
            aria-label="Movement"
            value={movement.id}
            onChange={(e) => setMovementId(e.target.value)}
            className="w-56">
            {movements.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
            className="w-44">
            {Object.entries(metrics).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        {data === undefined ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : points.length === 0 ? (
          <p className="text-sm text-slate-500">No completed workouts include this movement yet.</p>
        ) : (
          <LineChart
            points={points}
            formatX={(x) => formatDate(x, xTimeZone, chartDate)}
            formatY={(y) => numberFormat.format(y)}
            minTickStep={minTickStep}
            ariaLabel={`${label} for ${movement.name} over time`}
          />
        )}
      </CardContent>
    </Card>
  );
}
