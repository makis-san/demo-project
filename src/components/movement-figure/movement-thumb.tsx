import { backMuscles, frontMuscles, mapSilhouette } from "./anatomy";
import type { MuscleGroup } from "@/lib/muscles";
import { cn } from "@/lib/utils";

const mirror = "translate(200 0) scale(-1 1)";

/** Muscles seen on one side only. The rest (shoulders, traps, forearms, calves) show on both. */
const backOnly: MuscleGroup[] = ["lats", "lower_back", "glutes", "hamstrings", "triceps"];
const frontOnly: MuscleGroup[] = ["chest", "abs", "obliques", "biceps", "quads"];

/** Which side of the body shows the muscles best: the back for lats and glutes, the front for chest and abs. */
export function thumbSide(primary: readonly MuscleGroup[]): "front" | "back" {
  const back = primary.filter((m) => backOnly.includes(m)).length;
  const front = primary.filter((m) => frontOnly.includes(m)).length;
  return back > front ? "back" : "front";
}

function boxOf(outline: string) {
  const n = outline.match(/-?\d*\.?\d+/g)!.map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** The part of the picture to show: a square around the primary muscles, or the whole body when there are none. */
function viewBoxFor(side: "front" | "back", primary: readonly MuscleGroup[]) {
  const shapes = (side === "front" ? frontMuscles : backMuscles).filter(([m]) => primary.includes(m));
  if (shapes.length === 0) return "0 20 200 400";
  const boxes = shapes.map(([, outline]) => boxOf(outline));
  const minX = Math.min(...boxes.map((b) => b.minX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const maxY = Math.max(...boxes.map((b) => b.maxY));
  // The outline is half a body, mirrored, so the far edge is the mirror of the near one.
  const width = 200 - 2 * minX;
  const size = Math.min(400, Math.max(width, maxY - minY) + 36, 400);
  const side_ = Math.max(size, 120);
  const cx = 100;
  const cy = (minY + maxY) / 2;
  return `${(cx - side_ / 2).toFixed(1)} ${(cy - side_ / 2).toFixed(1)} ${side_.toFixed(1)} ${side_.toFixed(1)}`;
}

/**
 * The image on a movement card: a piece of the body map zoomed to the muscles the movement works, primary hot and
 * secondary half. It is the same drawing as the movement page, so the card says at a glance which part of the body it is.
 */
export function MovementThumb({
  primary,
  secondary,
  className,
}: {
  primary: readonly MuscleGroup[];
  secondary: readonly MuscleGroup[];
  className?: string;
}) {
  const side = thumbSide(primary);
  const muscles = side === "front" ? frontMuscles : backMuscles;
  return (
    <svg
      viewBox={viewBoxFor(side, primary)}
      aria-hidden="true"
      className={cn("body-thumb", className)}
      data-side={side}
      preserveAspectRatio="xMidYMid slice">
      <ellipse className="sil" cx="100" cy="30" rx="15" ry="20" />
      {mapSilhouette.map((d) => (
        <g key={d}>
          <path className="sil" d={d} />
          <path className="sil" d={d} transform={mirror} />
        </g>
      ))}
      {muscles.map(([group, outline]) => {
        const level = primary.includes(group) ? 1 : secondary.includes(group) ? 0.5 : 0;
        return (
          <g
            key={group}
            className="m"
            style={{ "--i": level } as React.CSSProperties}
            data-muscle={group}
            data-level={level}>
            <path d={outline} />
            <path d={outline} transform={mirror} />
          </g>
        );
      })}
    </svg>
  );
}
