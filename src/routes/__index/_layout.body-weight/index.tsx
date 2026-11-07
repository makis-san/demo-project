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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Body Weight</h1>

      <Card>
        <CardHeader>
          <CardTitle>Log Body Weight</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              type="number"
              aria-label={`Weight in ${weightUnit}`}
              placeholder={`Weight (${weightUnit})`}
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="sm:w-40"
              min={0.01}
              max={9999.99}
              step="0.01"
            />
            <Button type="submit" disabled={!(parseFloat(weight) > 0)} className="w-full sm:w-auto">
              <Plus className="w-4 h-4 mr-1" />
              {addMutation.isPending ? "Saving..." : "Log weight"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-500">No body weight logged yet. Add your first entry above!</p>
          ) : (
            <>
              <LineChart
                points={points}
                formatX={(x) => formatDate(x, timeZone, chartDate)}
                ariaLabel="Body weight over time"
              />
              <ul className="space-y-2" aria-label="Body weight entries">
                {[...entries].reverse().map((entry) => (
                  <li
                    key={entry.id}
                    className="px-3 py-2 bg-slate-50 rounded-lg text-sm flex items-center justify-between">
                    <div>
                      <span className="font-medium">
                        {entry.weight} {weightUnit}
                      </span>
                      <span className="text-slate-500 ml-2">{formatDate(entry.recordedAt, timeZone, shortDate)}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete entry"
                      onClick={() => deleteMutation.mutate(entry.id)}
                      className="h-10 w-10 text-slate-400 sm:h-8 sm:w-8">
                      <X className="w-4 h-4" />
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
