import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/sheet";
import { movementSubtitle, type MovementCardData } from "@/components/movement-card";
import { MovementFigure } from "@/components/movement-figure/movement-figure";
import { BodyMap, type MuscleRole } from "@/components/movement-figure/body-map";
import { MovementThumb } from "@/components/movement-figure/movement-thumb";
import { equipmentLabels, muscleLabels, type MuscleGroup } from "@/lib/muscles";
import { cn } from "@/lib/utils";
import { movementQueryOptions } from "@/routes/__index/_layout.movements/-queries/movements";

/**
 * What a movement is, for a sheet: the animated side view when it has one (or the body map), what it works, and how to
 * do it. It reads the same query as the movement page, so opening the page afterwards is instant. The card data the
 * list already has shows at once, and the guide fills in when it arrives.
 */
export function MovementDetail({ movement }: { movement: MovementCardData }) {
  const { data, isPending } = useQuery(movementQueryOptions(movement.id));
  const [step, setStep] = useState(0);
  const figure = data?.guide?.figure ?? null;
  const primary = data?.primaryMuscles ?? movement.primaryMuscles;
  const secondary = data?.secondaryMuscles ?? movement.secondaryMuscles;

  const roles: Partial<Record<MuscleGroup, MuscleRole>> = {};
  const levels: Partial<Record<MuscleGroup, number>> = {};
  for (const m of secondary) {
    roles[m] = "secondary";
    levels[m] = 0.5;
  }
  for (const m of primary) {
    roles[m] = "primary";
    levels[m] = 1;
  }

  return (
    <div className="space-y-5" data-testid="movement-detail">
      <div className="flex items-center gap-3">
        <MovementThumb primary={primary} secondary={secondary} className="h-14 w-14 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <p className="truncate text-xs text-faint">{movementSubtitle(movement)}</p>
          <div className="mt-1 flex flex-wrap gap-1.5" aria-label="About this movement">
            {movement.equipment && <Tag>{equipmentLabels[movement.equipment]}</Tag>}
            {movement.isBodyWeight && <Tag tone="ok">Body weight</Tag>}
            {!movement.isBuiltIn && <Tag>Yours</Tag>}
          </div>
        </div>
      </div>

      {isPending ? (
        <div className="figure-stage grid place-items-center text-sm text-faint" aria-busy="true">
          Loading…
        </div>
      ) : figure ? (
        <MovementFigure
          name={movement.name}
          figure={figure}
          primary={primary}
          secondary={secondary}
          onStepChange={setStep}
        />
      ) : null}

      <div className={cn("grid gap-5", figure && "sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]")}>
        <div className="space-y-4">
          <BodyMap
            levels={levels}
            roles={roles}
            label={`Muscles worked by ${movement.name}`}
            className={figure ? "max-w-60" : "mx-auto max-w-80"}
          />
          <MuscleList title="Primary" muscles={primary} tone="primary" />
          <MuscleList title="Secondary" muscles={secondary} tone="secondary" />
        </div>

        {data?.guide ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-chalk">How to do it</h3>
            <ol className="grid gap-1.5">
              {data.guide.steps.map((text, i) => {
                const on = !!figure && i === step;
                return (
                  <li
                    key={i}
                    data-on={on}
                    className={cn(
                      "grid grid-cols-[1.5rem_1fr] items-start gap-2.5 rounded-2xl border border-transparent px-2.5 py-2 text-sm text-muted transition-colors",
                      on && "border-line-strong bg-well text-chalk",
                    )}>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid h-6 w-6 place-items-center rounded-full text-xs font-bold transition-colors",
                        on ? "bg-primary text-primary-ink" : "bg-well text-faint",
                      )}>
                      {i + 1}
                    </span>
                    <span>{text}</span>
                  </li>
                );
              })}
            </ol>
            <p className="border-l-2 border-ok pl-3 text-sm text-muted">
              <b className="font-semibold text-ok">Watch for</b> {data.guide.watch}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The detail of one movement on its own sheet, for a movement already in a list (a workout being built). */
export function MovementDetailSheet({ movement, onClose }: { movement: MovementCardData; onClose: () => void }) {
  return (
    <Sheet label={movement.name} onEscape={onClose}>
      <div className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-5 sm:pt-4">
        <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">
          {movement.name}
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-5 sm:px-5">
        <MovementDetail movement={movement} />
      </div>
    </Sheet>
  );
}

/** The header of the detail view inside the picker: back to the list, the name, and the way to pick it. */
export function MovementDetailHeader({
  movement,
  onBack,
  selected,
  onToggle,
  onPick,
}: {
  movement: MovementCardData;
  onBack: () => void;
  selected?: boolean;
  onToggle?: () => void;
  onPick?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 pt-3 sm:px-4 sm:pt-4">
      <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to the list">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">
        {movement.name}
      </h2>
      {onToggle && (
        <Button variant={selected ? "secondary" : "outline"} size="sm" onClick={onToggle} aria-pressed={!!selected}>
          {selected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {selected ? "Selected" : "Select"}
        </Button>
      )}
      {onPick && (
        <Button size="sm" onClick={onPick}>
          Choose
        </Button>
      )}
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "ok" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs",
        tone === "ok" ? "border-ok/40 text-ok" : "border-line bg-well text-muted",
      )}>
      {children}
    </span>
  );
}

function MuscleList({
  title,
  muscles,
  tone,
}: {
  title: string;
  muscles: readonly MuscleGroup[];
  tone: "primary" | "secondary";
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold text-muted">{title}</h3>
      {muscles.length === 0 ? (
        <p className="text-xs text-faint">None</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${title} muscles`}>
          {muscles.map((m) => (
            <li
              key={m}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                tone === "primary"
                  ? "border-primary/60 bg-primary/20 text-accent"
                  : "border-line-strong bg-well text-muted",
              )}>
              {muscleLabels[m]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
