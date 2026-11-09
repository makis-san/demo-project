import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/stat";
import { calendarDays, type CalendarDay } from "@/lib/progression.server";
import { weightUnit } from "@/lib/units";
import { cn } from "@/lib/utils";
import { trainingCalendarQueryOptions } from "./-queries/workout-history";

const weeks = calendarDays / 7;
const dayMs = 24 * 60 * 60 * 1000;
const volumeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const longDayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

// Days are plain dates (YYYY-MM-DD) in the user's timezone, so the math is done on UTC midnights, where every day
// is exactly 24 hours long.
const toTime = (day: string) => Date.parse(`${day}T00:00:00Z`);
const toDay = (time: number) => new Date(time).toISOString().slice(0, 10);
/** Monday of the week the day is in. */
const weekStart = (time: number) => time - ((new Date(time).getUTCDay() + 6) % 7) * dayMs;

const levelClass = [
  "bg-white/[0.045]",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary shadow-[0_0_12px_-2px_var(--color-primary)]",
];

/**
 * The last 18 weeks as a grid of days, one column a week, lit by how much was lifted, with the numbers a lifter
 * checks first: this week, the streak of weeks trained, and the average. Tap a day to read it.
 */
export function TrainingCalendar({ timeZone }: { timeZone: string }) {
  const { data } = useSuspenseQuery(trainingCalendarQueryOptions(timeZone));
  const [picked, setPicked] = useState<string | null>(null);

  const byDay = new Map<string, CalendarDay>(data.days.map((d) => [d.day, d]));
  const today = toTime(data.today);
  const firstMonday = weekStart(today) - (weeks - 1) * 7 * dayMs;
  // Levels spread between the lightest and the heaviest day trained, so similar sessions still show which were
  // bigger. When every day is the same, they all sit in the middle.
  const volumes = data.days.map((d) => d.volume);
  const minVolume = Math.min(...volumes);
  const spread = Math.max(...volumes) - minVolume;

  const level = (d: CalendarDay | undefined) => {
    if (!d) return 0;
    if (spread <= 0) return 3;
    return 1 + Math.min(3, Math.floor(((d.volume - minVolume) / spread) * 4));
  };

  // Workouts in each week, oldest week first.
  const perWeek = Array.from({ length: weeks }, (_, w) => {
    let count = 0;
    for (let d = 0; d < 7; d++) count += byDay.get(toDay(firstMonday + (w * 7 + d) * dayMs))?.workouts ?? 0;
    return count;
  });
  // The streak counts back from this week, or from last week while this one has nothing yet.
  let streak = 0;
  for (let w = perWeek[weeks - 1] > 0 ? weeks - 1 : weeks - 2; w >= 0 && perWeek[w] > 0; w--) streak++;
  const total = perWeek.reduce((a, b) => a + b, 0);

  const pickedDay = picked ? byDay.get(picked) : undefined;

  return (
    <Card className="enter enter-1 p-5 sm:p-7">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
        <div className="space-y-5 lg:w-56 lg:shrink-0">
          <div className="space-y-1.5">
            <p className="eyebrow">Consistency</p>
            <h2 className="text-lg leading-tight font-semibold tracking-tight text-chalk font-stretch-[112%]">
              Training calendar
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-4 lg:grid-cols-1 lg:gap-5">
            <Stat label="This week" value={perWeek[weeks - 1]} morph />
            <Stat label="Week streak" value={streak} morph />
            <Stat label={`Last ${weeks} wk`} value={total} morph />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div
            role="img"
            aria-label={`${total} workouts in the last ${weeks} weeks, ${streak} weeks in a row`}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
            <div />
            <div
              className="mb-1.5 grid gap-[3px] sm:gap-1"
              style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
              {Array.from({ length: weeks }, (_, w) => {
                const monday = firstMonday + w * 7 * dayMs;
                const label = w === 0 || new Date(monday).getUTCDate() <= 7 ? monthFormat.format(monday) : "";
                return (
                  <span key={w} className="overflow-visible text-[10px] whitespace-nowrap text-faint">
                    {label}
                  </span>
                );
              })}
            </div>
            <div className="grid grid-rows-7 gap-[3px] text-[10px] leading-none text-faint sm:gap-1">
              {["Mon", "", "Wed", "", "Fri", "", ""].map((d, i) => (
                <span key={i} className="flex items-center">
                  {d}
                </span>
              ))}
            </div>
            <div
              className="grid grid-flow-col grid-rows-7 gap-[3px] sm:gap-1"
              style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
              {Array.from({ length: weeks * 7 }, (_, i) => {
                const time = firstMonday + i * dayMs;
                const day = toDay(time);
                const entry = byDay.get(day);
                const future = time > today;
                return (
                  <div
                    key={day}
                    onClick={() => !future && setPicked(day === picked ? null : day)}
                    title={entry ? describe(day, entry) : undefined}
                    className={cn(
                      "aspect-square rounded-[4px] transition-transform duration-150",
                      future ? "bg-transparent" : levelClass[level(entry)],
                      !future && "cursor-pointer hover:scale-110",
                      time === today && "ring-1 ring-chalk/60 ring-offset-1 ring-offset-transparent",
                      day === picked && "ring-2 ring-primary",
                    )}
                  />
                );
              })}
            </div>
          </div>
          <div className="mt-3 flex min-h-5 flex-wrap items-center justify-between gap-3 text-xs text-muted">
            <p className="num">
              {picked
                ? pickedDay
                  ? describe(picked, pickedDay)
                  : `${longDayFormat.format(toTime(picked))}: rest day`
                : "Tap a day to see it"}
            </p>
            <div className="flex items-center gap-1.5" aria-hidden="true">
              Less
              {levelClass.map((c, i) => (
                <span key={i} className={cn("h-2.5 w-2.5 rounded-[3px]", c)} />
              ))}
              More
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function describe(day: string, entry: CalendarDay) {
  const workouts = `${entry.workouts} ${entry.workouts === 1 ? "workout" : "workouts"}`;
  return `${longDayFormat.format(toTime(day))}: ${workouts} · ${entry.sets} sets · ${volumeFormat.format(entry.volume)} ${weightUnit}`;
}
