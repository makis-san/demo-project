import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LineChart } from "@/components/ui/line-chart";
import { addBodyWeightServerFn, deleteBodyWeightServerFn } from "@/lib/body-weight.server";
import { chartDate, formatDate, shortDate } from "@/lib/dates";
import { bodyWeightQueryOptions } from "./-queries/body-weight";
import { weightUnit } from "@/lib/units";
import { PageHeader } from "@/components/page-header";
import { Stat } from "@/components/stat";

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const Route = createFileRoute("/__index/_layout/body-weight/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(bodyWeightQueryOptions());
  },
  component: BodyWeightPage,
});

function BodyWeightPage() {
  const { timeZone } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: entries } = useSuspenseQuery(bodyWeightQueryOptions());
  const [weight, setWeight] = useState("");

  const addMutation = useMutation({
    mutationFn: (value: number) => addBodyWeightServerFn({ data: { weight: value } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bodyWeightQueryOptions().queryKey });
      setWeight("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const result = await deleteBodyWeightServerFn({ data: { id } });
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bodyWeightQueryOptions().queryKey });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = parseFloat(weight);
    if (!(value > 0)) return;
    addMutation.mutate(value);
  };

  const points = entries.map((entry) => ({
    x: new Date(entry.recordedAt).getTime(),
    y: entry.weight,
    title: `${entry.weight} ${weightUnit} on ${formatDate(entry.recordedAt, timeZone, shortDate)}`,
  }));

  const latest = entries[entries.length - 1];
  const previous = entries[entries.length - 2];
  const change = latest && previous ? latest.weight - previous.weight : null;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Track" title="Body Weight" />

      <Card className="enter enter-1">
        <CardHeader className="gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <p className="eyebrow">Today</p>
            <CardTitle>Log Body Weight</CardTitle>
          </div>
          {latest && (
            <div className="flex items-end gap-5">
              <Stat label="Latest" value={numberFormat.format(latest.weight)} unit={weightUnit} />
              {change !== null && (
                <p className="num mb-6 rounded-full bg-well px-2.5 py-1 text-xs font-semibold text-muted">
                  {change > 0 ? "+" : change < 0 ? "−" : "±"}
                  {numberFormat.format(Math.abs(change))} since last
                </p>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit}
            className="grid gap-2 rounded-[1.375rem] border border-line bg-black/20 p-2 sm:w-fit sm:grid-cols-[14rem_auto]">
            <Input
              type="number"
              aria-label={`Weight in ${weightUnit}`}
              placeholder={`Weight (${weightUnit})`}
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              min={0.01}
              max={9999.99}
              step="0.01"
            />
            <Button type="submit" disabled={!(parseFloat(weight) > 0)} className="h-12">
              <Plus className="h-4 w-4" />
              {addMutation.isPending ? "Saving..." : "Log weight"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="enter enter-2">
        <CardHeader>
          <p className="eyebrow">Over time</p>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {entries.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
              No body weight logged yet. Add your first entry above!
            </p>
          ) : (
            <>
              <LineChart
                points={points}
                formatX={(x) => formatDate(x, timeZone, chartDate)}
                ariaLabel="Body weight over time"
              />
              <ul className="space-y-1.5" aria-label="Body weight entries">
                {[...entries].reverse().map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 rounded-2xl bg-well py-2 pr-2 pl-4 transition-colors hover:bg-white/[0.07]">
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4">
                      <span className="num font-semibold text-chalk">
                        {entry.weight} {weightUnit}
                      </span>
                      <span className="num text-sm text-muted">
                        {formatDate(entry.recordedAt, timeZone, shortDate)}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete entry"
                      onClick={() => deleteMutation.mutate(entry.id)}
                      className="h-10 w-10 text-faint hover:text-danger">
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
