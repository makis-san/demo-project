import { cn } from "@/lib/utils";

/** A big tabular number with its label under it, like a scoreboard reading. */
export function Stat({
  label,
  value,
  unit,
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="num flex items-baseline gap-1 text-3xl font-bold tracking-tight font-stretch-[88%] text-chalk sm:text-4xl">
        {value}
        {unit && <span className="text-sm font-medium font-stretch-100% text-muted">{unit}</span>}
      </p>
      <p className="eyebrow mt-1">{label}</p>
    </div>
  );
}
