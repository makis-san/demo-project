import { cn } from "@/lib/utils";
import { Morph } from "@/components/morph";

/** A tabular number with its label under it, in small normal-case text. */
export function Stat({
  label,
  value,
  unit,
  className,
  morph,
}: {
  label: string;
  value: string | number;
  unit?: string;
  className?: string;
  /** Roll the digits when the value changes. Display only: see Morph. */
  morph?: boolean;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="num flex items-baseline gap-1 text-2xl font-bold tracking-tight font-stretch-[88%] text-chalk sm:text-3xl">
        {morph ? <Morph value={value} /> : value}
        {unit && <span className="text-sm font-medium font-stretch-100% text-muted">{unit}</span>}
      </p>
      <p className="mt-0.5 text-[13px] text-muted">{label}</p>
    </div>
  );
}
