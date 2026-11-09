import { BodyMap } from "@/components/movement-figure/body-map";
import { muscleGroups, muscleLabels, type MuscleGroup } from "@/lib/muscles";
import { cn } from "@/lib/utils";

type Role = "none" | "primary" | "secondary";

export type MuscleSelection = { primary: MuscleGroup[]; secondary: MuscleGroup[] };

const nextRole: Record<Role, Role> = { none: "primary", primary: "secondary", secondary: "none" };
const roleText: Record<Role, string> = { none: "not used", primary: "primary", secondary: "secondary" };

/**
 * Picks the muscles of a custom movement. Each tap on a muscle, on the body map or on its button, steps through
 * not used, primary, secondary. The buttons are the keyboard and screen reader route, the map is the quick one.
 * It is optional: a movement saved with none still works, it just adds nothing to the muscles view.
 */
export function MusclePicker({
  value,
  onChange,
}: {
  value: MuscleSelection;
  onChange: (value: MuscleSelection) => void;
}) {
  const roleOf = (muscle: MuscleGroup): Role =>
    value.primary.includes(muscle) ? "primary" : value.secondary.includes(muscle) ? "secondary" : "none";

  const cycle = (muscle: MuscleGroup) => {
    const role = nextRole[roleOf(muscle)];
    onChange({
      primary: role === "primary" ? [...value.primary, muscle] : value.primary.filter((m) => m !== muscle),
      secondary: role === "secondary" ? [...value.secondary, muscle] : value.secondary.filter((m) => m !== muscle),
    });
  };

  const levels: Partial<Record<MuscleGroup, number>> = {};
  for (const m of value.secondary) levels[m] = 0.5;
  for (const m of value.primary) levels[m] = 1;

  return (
    <div className="space-y-3">
      <div className="mx-auto max-w-sm">
        <BodyMap levels={levels} onToggle={cycle} label="Pick muscles" />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Muscles">
        {muscleGroups.map((muscle) => {
          const role = roleOf(muscle);
          return (
            <button
              key={muscle}
              type="button"
              aria-label={`${muscleLabels[muscle]}: ${roleText[role]}`}
              data-role={role}
              onClick={() => cycle(muscle)}
              className={cn(
                "press h-9 rounded-full border px-3 text-xs font-semibold",
                role === "primary" && "border-primary/60 bg-primary/20 text-accent",
                role === "secondary" && "border-line-strong bg-white/[0.08] text-chalk",
                role === "none" && "border-line bg-well text-muted hover:text-chalk",
              )}>
              {muscleLabels[muscle]}
              {role !== "none" && (
                <span className="ml-1.5 font-medium opacity-70">{role === "primary" ? "1" : "½"}</span>
              )}
            </button>
          );
        })}
      </div>
      <p className="px-1 text-xs text-faint">
        Tap a muscle to mark it as primary (counts a full set), again for secondary (counts half), and again to clear
        it.
      </p>
    </div>
  );
}
