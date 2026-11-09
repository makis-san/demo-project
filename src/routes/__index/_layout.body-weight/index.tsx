import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, X, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StepButton, stepValue } from "@/components/stepper";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { LineChart } from "@/components/ui/line-chart";
import { addBodyWeightServerFn, deleteBodyWeightServerFn, updateBodyWeightServerFn } from "@/lib/body-weight.server";
import { bodyWeightSchema } from "@/lib/validation";
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
  const [range, setRange] = useState<Range>("all");

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

  // The entry being edited in place, if any.
  const [editingId, setEditingId] = useState<string | null>(null);
  const updateMutation = useMutation({
    mutationFn: async (input: { id: string; weight: number; recordedAt: Date }) => {
      const result = await updateBodyWeightServerFn({ data: input });
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => setEditingId(null),
    // Also after a refusal, so the list shows what the server has. The chart, the latest weight that
    // body-weight movements start from and the stats all read this key.
    onSettled: () => queryClient.invalidateQueries({ queryKey: bodyWeightQueryOptions().queryKey }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = parseFloat(weight);
    if (!(value > 0)) return;
    addMutation.mutate(value);
  };

  const latest = entries[entries.length - 1];
  // Ranges count back from the latest entry, not from the clock, so the server and the browser draw the same thing.
  const latestTime = latest ? new Date(latest.recordedAt).getTime() : 0;
  const inRange = entries.filter(
    (entry) => range === "all" || new Date(entry.recordedAt).getTime() >= latestTime - rangeDays[range] * dayMs,
  );
  const points = inRange.map((entry) => ({
    x: new Date(entry.recordedAt).getTime(),
    y: entry.weight,
    title: `${entry.weight} ${weightUnit} on ${formatDate(entry.recordedAt, timeZone, shortDate)}`,
  }));
  const rangeChange = inRange.length > 1 ? inRange[inRange.length - 1].weight - inRange[0].weight : null;
  const weights = inRange.map((entry) => entry.weight);
  const loggedToday =
    latest && formatDate(latest.recordedAt, timeZone, shortDate) === formatDate(Date.now(), timeZone, shortDate);

  return (
    <div className="space-y-6">
      <PageHeader title="Body Weight" />

      <Card className="enter enter-1 p-3 sm:p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-end justify-between gap-3 px-2 pt-2">
            <div className="space-y-1">
              <p className="eyebrow">Weigh in</p>
              <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">Log Body Weight</h2>
            </div>
            {latest && (
              <button
                type="button"
                onClick={() => setWeight(String(latest.weight))}
                className="press num h-10 shrink-0 rounded-full border border-line bg-white/[0.04] px-3.5 text-xs font-semibold text-muted hover:border-line-strong hover:text-chalk">
                Same as last · <span className="text-chalk">{numberFormat.format(latest.weight)}</span>
              </button>
            )}
          </div>

          <div className="rounded-[1.375rem] border border-line bg-black/25 p-2">
            <div className="flex items-center gap-2">
              <StepButton
                direction="down"
                onStep={() => setWeight(stepValue(weight, -0.1, { start: latest?.weight }))}
                className="h-14 w-14">
                0.1 less
              </StepButton>
              <div className="relative min-w-0 flex-1">
                <Input
                  type="number"
                  aria-label={`Weight in ${weightUnit}`}
                  placeholder={latest ? numberFormat.format(latest.weight) : "0.0"}
                  inputMode="decimal"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  min={0.01}
                  max={9999.99}
                  step="0.01"
                  className="h-20 rounded-2xl border-transparent bg-transparent pr-9 pl-2 text-center text-[2.5rem] sm:pr-12 sm:pl-12 sm:text-5xl font-bold tracking-tight font-stretch-[85%] [appearance:textfield] placeholder:text-faint/50 hover:border-transparent focus-visible:bg-black/30 [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span
                  className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-sm text-muted sm:right-4"
                  aria-hidden="true">
                  {weightUnit}
                </span>
              </div>
              <StepButton
                direction="up"
                onStep={() => setWeight(stepValue(weight, 0.1, { start: latest?.weight }))}
                className="h-14 w-14">
                0.1 more
              </StepButton>
            </div>
          </div>

          <Button type="submit" disabled={!(parseFloat(weight) > 0)} className="h-12 w-full text-base">
            <Plus className="h-5 w-5" />
            {addMutation.isPending ? "Saving..." : "Log weight"}
          </Button>
          {loggedToday && (
            <p className="num px-2 pb-1 text-center text-xs text-faint">
              Already logged {numberFormat.format(latest.weight)} {weightUnit} today. Another entry adds a second point.
            </p>
          )}
        </form>
      </Card>

      <Card className="enter enter-2 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-2 pb-4">
          <div className="space-y-1">
            <p className="eyebrow">Over time</p>
            <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">History</h2>
          </div>
          {entries.length > 0 && (
            <div className="flex gap-1 rounded-full bg-black/25 p-1" role="group" aria-label="Range">
              {(Object.keys(rangeLabels) as Range[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={range === key}
                  onClick={() => setRange(key)}
                  className={cn(
                    "press h-9 rounded-full px-3.5 text-xs font-semibold",
                    range === key ? "bg-white/[0.12] text-chalk" : "text-faint hover:text-chalk",
                  )}>
                  {rangeLabels[key]}
                </button>
              ))}
            </div>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">
            No body weight logged yet. Add your first entry above!
          </p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 px-2 sm:grid-cols-4">
              <Stat label="Latest" value={numberFormat.format(latest.weight)} unit={weightUnit} morph />
              <Stat
                label={range === "all" ? "Change, all time" : `Change, ${rangeLabels[range]}`}
                value={rangeChange === null ? "–" : signed(rangeChange)}
                unit={rangeChange === null ? undefined : weightUnit}
                morph
              />
              <Stat label="Lowest" value={numberFormat.format(Math.min(...weights))} unit={weightUnit} morph />
              <Stat label="Highest" value={numberFormat.format(Math.max(...weights))} unit={weightUnit} morph />
            </div>
            {points.length > 0 && (
              <LineChart
                points={points}
                formatX={(x) => formatDate(x, timeZone, chartDate)}
                ariaLabel="Body weight over time"
              />
            )}
            <ul className="space-y-1.5" aria-label="Body weight entries">
              {[...entries].reverse().map((entry, i, newestFirst) => {
                const before = newestFirst[i + 1];
                const delta = before ? entry.weight - before.weight : null;
                return (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl bg-well py-1.5 pr-1.5 pl-4 transition-colors hover:bg-white/[0.07]">
                    {editingId === entry.id ? (
                      <EntryEditor
                        entry={entry}
                        timeZone={timeZone}
                        pending={updateMutation.isPending}
                        onCancel={() => setEditingId(null)}
                        onSave={(weight, recordedAt) => updateMutation.mutate({ id: entry.id, weight, recordedAt })}
                      />
                    ) : (
                      <>
                        <span className="num min-w-0 flex-1 text-lg font-bold text-chalk font-stretch-[90%]">
                          {entry.weight} {weightUnit}
                        </span>
                        {delta !== null && <DeltaChip delta={delta} />}
                        <span className="num w-24 shrink-0 text-right text-xs text-muted">
                          {formatDate(entry.recordedAt, timeZone, shortDate)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Edit entry"
                          onClick={() => setEditingId(entry.id)}
                          className="h-10 w-10 shrink-0 text-faint hover:text-chalk">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete entry"
                          onClick={() => deleteMutation.mutate(entry.id)}
                          className="h-10 w-10 shrink-0 text-faint hover:text-danger">
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

type Range = "30" | "90" | "all";
const rangeDays = { "30": 30, "90": 90, all: Infinity } as const;
const rangeLabels: Record<Range, string> = { "30": "30 days", "90": "90 days", all: "All" };
const dayMs = 24 * 60 * 60 * 1000;

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${numberFormat.format(Math.abs(n))}`;

/** The change from the entry before, as an arrow and the amount. Neutral colours: up or down isn't good or bad. */
function DeltaChip({ delta }: { delta: number }) {
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  return (
    <span className="num inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-muted">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {numberFormat.format(Math.abs(delta))}
    </span>
  );
}

/** The date as YYYY-MM-DD in a timezone, the value of a date field. */
function dateInput(value: Date | string | number, timeZone: string) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone });
}

/**
 * An entry's weight and date as fields, in place of its row. The weight follows the rules of adding one. The date
 * keeps the time of day of the entry, so moving it to another day does not reorder two weigh-ins of the same day.
 */
function EntryEditor({
  entry,
  timeZone,
  pending,
  onSave,
  onCancel,
}: {
  entry: { weight: number; recordedAt: Date | string };
  timeZone: string;
  pending: boolean;
  onSave: (weight: number, recordedAt: Date) => void;
  onCancel: () => void;
}) {
  const [weight, setWeight] = useState(String(entry.weight));
  const [day, setDay] = useState(dateInput(entry.recordedAt, timeZone));
  const today = dateInput(Date.now(), timeZone);

  const weightResult = bodyWeightSchema.safeParse(weight === "" ? NaN : Number(weight));
  const error = !weightResult.success
    ? `Weight: ${weightResult.error.issues[0]?.message ?? "invalid"}`
    : !day || day > today
      ? "The date can't be in the future"
      : null;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (error) return;
    const original = new Date(entry.recordedAt);
    // The same day keeps the entry exactly as it was, so editing the weight never moves it in the list.
    if (day === dateInput(original, timeZone)) return onSave(Number(weight), original);
    // Another day keeps the time of day of the original, in the browser's timezone, which is the one the page shows.
    const [y, m, d] = day.split("-").map(Number);
    const moved = new Date(
      y,
      m - 1,
      d,
      original.getHours(),
      original.getMinutes(),
      original.getSeconds(),
      original.getMilliseconds(),
    );
    // A weigh-in is already done: never later than now.
    onSave(Number(weight), moved.getTime() > Date.now() ? new Date() : moved);
  };

  return (
    <form onSubmit={save} className="min-w-0 flex-1 basis-full space-y-1.5 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          aria-label="Edit weight"
          inputMode="decimal"
          min={0.01}
          max={9999.99}
          step="0.01"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          autoFocus
          className="num h-11 w-28 text-center text-base"
        />
        <span className="text-sm text-muted">{weightUnit}</span>
        <Input
          type="date"
          aria-label="Edit date"
          value={day}
          max={today}
          onChange={(e) => setDay(e.target.value)}
          className="num h-11 w-40 text-base"
        />
        <Button type="submit" size="icon" disabled={!!error || pending} aria-label="Save entry" className="h-11 w-11">
          <Check className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Cancel edit"
          onClick={onCancel}
          className="h-11 w-11">
          <X className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="px-1 text-xs text-danger">{error}</p>}
    </form>
  );
}
