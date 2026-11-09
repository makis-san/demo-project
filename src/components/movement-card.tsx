import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { MovementThumb } from "@/components/movement-figure/movement-thumb";
import { equipmentLabels, muscleLabels, type Equipment, type MuscleGroup } from "@/lib/muscles";
import { cn } from "@/lib/utils";

/** What the workout needs to know about the movement it is logging. */
export type MovementOption = { id: string; name: string; isBodyWeight: boolean };

export type MovementCardData = {
  id: string;
  name: string;
  isBodyWeight: boolean;
  isBuiltIn: boolean;
  equipment: Equipment | null;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
};

/** "Barbell · Chest, Shoulders", or a hint when a custom movement has no muscles. */
export function movementSubtitle(m: Pick<MovementCardData, "equipment" | "primaryMuscles">) {
  return (
    [m.equipment && equipmentLabels[m.equipment], m.primaryMuscles.map((x) => muscleLabels[x]).join(", ")]
      .filter(Boolean)
      .join(" · ") || "No muscles set"
  );
}

/**
 * A movement as a card: the body-part image first, then the name and what it works, and a checkmark to select it.
 * With `href` the card opens the movement page. With `selected` and `onToggle` the checkmark selects it for a workout.
 * The checkmark is a real checkbox, so it is reachable and named for the movement, and it sits above the link.
 */
export function MovementCard({
  movement,
  href,
  selected,
  onToggle,
  highlight,
  onPick,
  children,
}: {
  movement: MovementCardData;
  /** With `onPick` the whole card is one button that picks this movement, and there is no checkmark. */
  onPick?: () => void;
  href?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  highlight?: boolean;
  /** Extra text or a badge on the right, before the checkmark. */
  children?: React.ReactNode;
}) {
  const selectable = onToggle !== undefined;
  return (
    <div
      data-selected={selectable ? !!selected : undefined}
      className={cn(
        "relative flex min-h-[4.5rem] min-w-0 items-center gap-3 rounded-2xl border bg-well p-2 pr-3 transition-colors hover:bg-white/[0.07]",
        selected ? "border-primary/60 bg-primary/10" : "border-transparent",
        highlight && "enter ring-1 ring-primary/60",
      )}>
      <MovementThumb
        primary={movement.primaryMuscles}
        secondary={movement.secondaryMuscles}
        className="h-14 w-14 shrink-0 rounded-xl"
      />
      <div className="min-w-0 flex-1">
        {onPick ? (
          <button
            type="button"
            onClick={onPick}
            className="block max-w-full truncate text-left text-[15px] font-medium text-chalk after:absolute after:inset-0 after:rounded-2xl">
            {movement.name}
          </button>
        ) : href ? (
          <Link
            to="/movements/$movementId"
            params={{ movementId: movement.id }}
            className="block truncate text-[15px] font-medium text-chalk after:absolute after:inset-0 after:rounded-2xl">
            {movement.name}
          </Link>
        ) : (
          <p className="truncate text-[15px] font-medium text-chalk">{movement.name}</p>
        )}
        <p className="truncate text-xs text-faint">{movementSubtitle(movement)}</p>
      </div>
      {!movement.isBuiltIn && (
        <span className="relative shrink-0 rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-muted">
          Yours
        </span>
      )}
      {movement.isBodyWeight && (
        <span className="relative shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-accent">
          Body weight
        </span>
      )}
      {children}
      {selectable && (
        <button
          type="button"
          role="checkbox"
          aria-checked={!!selected}
          aria-label={`Select ${movement.name}`}
          onClick={onToggle}
          className={cn(
            "press relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors",
            selected
              ? "border-primary bg-primary text-primary-ink"
              : "border-line-strong bg-black/20 text-transparent hover:text-faint",
          )}>
          <Check className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
