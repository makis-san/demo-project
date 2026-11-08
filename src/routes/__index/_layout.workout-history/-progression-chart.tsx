import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart } from "@/components/ui/line-chart";
import { Select } from "@/components/ui/select";
import { chartDate, formatDate, shortDate } from "@/lib/dates";
import type { ProgressionRow } from "@/lib/progression.server";
import { progressionQueryOptions } from "./-queries/workout-history";

const metrics = {
  maxWeight: { label: "Max weight", unit: "lbs", minTickStep: 0 },
  totalReps: { label: "Total reps", unit: "reps", minTickStep: 1 },
  totalVolume: { label: "Total volume", unit: "lbs", minTickStep: 0 },
} as const satisfies Record<keyof Omit<ProgressionRow, "day">, { label: string; unit: string; minTickStep: number }>;

type Metric = keyof typeof metrics;

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** Plots one metric for one movement, one point per day, from completed workouts. */
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
  const { data: rows } = useQuery(progressionQueryOptions(movement.id, timeZone));

  const { label, unit, minTickStep } = metrics[metric];
  // A day is a plain date already in the user's timezone, so read it as UTC to format it as that same date.
  const points = (rows ?? []).map((row) => {
    const x = Date.parse(`${row.day}T00:00:00Z`);
    return {
      x,
      y: row[metric],
      title: `${numberFormat.format(row[metric])} ${unit} on ${formatDate(x, "UTC", shortDate)}`,
    };
  });

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
        {rows === undefined ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : points.length === 0 ? (
          <p className="text-sm text-slate-500">No completed workouts include this movement yet.</p>
        ) : (
          <LineChart
            points={points}
            formatX={(x) => formatDate(x, "UTC", chartDate)}
            formatY={(y) => numberFormat.format(y)}
            minTickStep={minTickStep}
            ariaLabel={`${label} for ${movement.name} over time`}
          />
        )}
      </CardContent>
    </Card>
  );
}
