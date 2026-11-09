import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Morph } from "@/components/morph";
import { equipmentLabels, equipmentTypes, type Equipment } from "@/lib/muscles";
import { cn } from "@/lib/utils";

export type ShowFilter = "all" | "weighted" | "bodyWeight";

export type FilterState = {
  equipment: Equipment | "";
  show: ShowFilter;
  mineOnly: boolean;
};

type ControlsProps = {
  state: FilterState;
  onChange: (next: Partial<FilterState>) => void;
  counts: Record<ShowFilter, number>;
  mineCount: number;
  /** In the sheet the controls are full width and stacked. Inline they are one row of compact controls. */
  layout: "inline" | "sheet";
};

const shows = [
  ["all", "All"],
  ["weighted", "Weighted"],
  ["bodyWeight", "Body wt"],
] as const;

/** How many of the three filters are set, for the number on the Filters button. */
export function activeFilterCount({ equipment, show, mineOnly }: FilterState) {
  return (equipment ? 1 : 0) + (show !== "all" ? 1 : 0) + (mineOnly ? 1 : 0);
}

/**
 * Equipment, All / Weighted / Body wt, and Mine. The page renders these once: inline from md up, and inside the sheet
 * on a phone (which only mounts them while it is open), so a screen reader never meets two sets.
 */
export function FilterControls({ state, onChange, counts, mineCount, layout }: ControlsProps) {
  const sheet = layout === "sheet";
  const segment = (on: boolean) =>
    cn(
      "press flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold whitespace-nowrap",
      sheet && "flex-1",
      on ? "bg-white/[0.12] text-chalk" : "text-faint hover:text-chalk",
    );
  return (
    <div className={cn(sheet ? "space-y-5" : "flex flex-wrap items-center gap-2")}>
      <Select
        aria-label="Filter by equipment"
        value={state.equipment}
        onChange={(e) => onChange({ equipment: e.target.value as Equipment | "" })}
        className={sheet ? "" : "h-11 w-auto min-w-44"}>
        <option value="">Any equipment</option>
        {equipmentTypes.map((e) => (
          <option key={e} value={e}>
            {equipmentLabels[e]}
          </option>
        ))}
      </Select>
      <div className="flex gap-1 rounded-full bg-black/25 p-1" role="group" aria-label="Show">
        {shows.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={state.show === key}
            onClick={() => onChange({ show: key })}
            className={segment(state.show === key)}>
            {label}
            <span aria-hidden="true" className={state.show === key ? "text-accent" : ""}>
              <Morph value={counts[key]} />
            </span>
          </button>
        ))}
        {!sheet && (
          <button
            type="button"
            aria-pressed={state.mineOnly}
            onClick={() => onChange({ mineOnly: !state.mineOnly })}
            className={segment(state.mineOnly)}>
            Mine
            <span aria-hidden="true" className={state.mineOnly ? "text-accent" : ""}>
              <Morph value={mineCount} />
            </span>
          </button>
        )}
      </div>
      {sheet && (
        <button
          type="button"
          aria-pressed={state.mineOnly}
          onClick={() => onChange({ mineOnly: !state.mineOnly })}
          className={cn(
            "press flex h-12 w-full items-center justify-between rounded-field border px-4 text-sm font-semibold",
            state.mineOnly ? "border-primary/60 bg-primary/15 text-chalk" : "border-line bg-white/[0.04] text-muted",
          )}>
          Mine
          <span className="num text-xs text-faint">{mineCount}</span>
        </button>
      )}
    </div>
  );
}

/** The filters on a phone, as a bottom sheet in the style of the movement chooser. */
export function FilterSheet({
  onClose,
  shown,
  onClear,
  ...controls
}: Omit<ControlsProps, "layout"> & { onClose: () => void; shown: number; onClear: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const any = activeFilterCount(controls.state) > 0;
  return createPortal(
    <div
      className="sheet-backdrop fixed inset-0 z-50 grid place-items-end bg-black/60 backdrop-blur-sm sm:place-items-center"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        data-sheet
        className="sheet glass glass-strong flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] pb-[env(safe-area-inset-bottom)] sm:max-w-md sm:rounded-panel sm:pb-0">
        <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-5 sm:pt-4">
          <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">Filters</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-4 py-4 sm:px-5">
          <FilterControls {...controls} layout="sheet" />
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-3 sm:px-5">
          <Button variant="ghost" onClick={onClear} disabled={!any}>
            Clear
          </Button>
          <Button onClick={onClose} className="flex-1">
            Show {shown} {shown === 1 ? "movement" : "movements"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
