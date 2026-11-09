import { movementCategories, type MovementCategory } from "@/lib/muscles";
import { cn } from "@/lib/utils";

/**
 * The tabs that filter movements by body part: All, Chest, Back, Biceps... One row that scrolls sideways on a phone.
 * `counts` shows how many movements each tab holds, where the page knows them.
 */
export function CategoryTabs({
  value,
  onChange,
  counts,
  label = "Body part",
  className,
}: {
  value: MovementCategory | null;
  onChange: (category: MovementCategory | null) => void;
  counts?: Partial<Record<MovementCategory | "all", number>>;
  label?: string;
  className?: string;
}) {
  const tabs: { id: MovementCategory | null; label: string }[] = [
    { id: null, label: "All" },
    ...movementCategories.map((c) => ({ id: c.id as MovementCategory, label: c.label })),
  ];
  return (
    <div role="tablist" aria-label={label} className={cn("-mx-1 flex gap-1 overflow-x-auto px-1 pb-1", className)}>
      {tabs.map((tab) => {
        const active = tab.id === value;
        const count = counts?.[tab.id ?? "all"];
        return (
          <button
            key={tab.id ?? "all"}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "press flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap",
              active
                ? "border-primary/60 bg-primary/15 text-chalk"
                : "border-line bg-white/[0.04] text-muted hover:border-line-strong hover:text-chalk",
            )}>
            {tab.label}
            {count !== undefined && (
              <span aria-hidden="true" className={cn("num text-xs", active ? "text-accent" : "text-faint")}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
