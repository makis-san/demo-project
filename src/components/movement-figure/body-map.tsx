import { backMuscles, frontMuscles, mapSilhouette, type MapMuscle } from "./anatomy";
import { cn } from "@/lib/utils";
import { muscleLabels, type MuscleGroup } from "@/lib/muscles";

const mirror = "translate(200 0) scale(-1 1)";

export type MuscleRole = "primary" | "secondary";

/**
 * The front and back of a body with each muscle group tinted by `levels` (0 to 1, missing is 0). Only half a body is
 * drawn and mirrored, so the left and right light together.
 *
 * The same map shows a movement's muscles, the muscles worked this week, and the picker for a custom movement. Each
 * muscle carries `data-muscle`, `data-level` and, when given, `data-role`, so a test can read what is lit.
 * With `onToggle`, clicking a muscle calls it. The map is not the keyboard route: the picker has buttons for that.
 */
export function BodyMap({
  levels,
  roles,
  onToggle,
  label = "Muscles",
  className,
}: {
  levels: Partial<Record<MuscleGroup, number>>;
  roles?: Partial<Record<MuscleGroup, MuscleRole>>;
  onToggle?: (muscle: MuscleGroup) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("body-map", className)}>
      <Figure side="Front" muscles={frontMuscles} {...{ levels, roles, onToggle, label }} />
      <Figure side="Back" muscles={backMuscles} {...{ levels, roles, onToggle, label }} />
    </div>
  );
}

function Figure({
  side,
  muscles,
  levels,
  roles,
  onToggle,
  label,
}: {
  side: "Front" | "Back";
  muscles: readonly MapMuscle[];
  levels: Partial<Record<MuscleGroup, number>>;
  roles?: Partial<Record<MuscleGroup, MuscleRole>>;
  onToggle?: (muscle: MuscleGroup) => void;
  label: string;
}) {
  return (
    <figure>
      <svg viewBox="0 0 200 424" role="img" aria-label={`${label}, ${side.toLowerCase()}`}>
        <ellipse className="sil" cx="100" cy="30" rx="15" ry="20" />
        {mapSilhouette.map((d) => (
          <g key={d}>
            <path className="sil" d={d} />
            <path className="sil" d={d} transform={mirror} />
          </g>
        ))}
        {muscles.map(([group, outline]) => {
          const level = levels[group] ?? 0;
          return (
            <g
              key={group}
              className={onToggle ? "m cursor-pointer" : "m"}
              style={{ "--i": level } as React.CSSProperties}
              data-muscle={group}
              data-level={level}
              data-role={roles?.[group]}
              onClick={onToggle && (() => onToggle(group))}>
              <title>{muscleLabels[group]}</title>
              <path d={outline} />
              <path d={outline} transform={mirror} />
            </g>
          );
        })}
      </svg>
      <figcaption>{side}</figcaption>
    </figure>
  );
}
