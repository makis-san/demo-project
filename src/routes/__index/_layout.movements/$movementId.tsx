import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { MovementFigure } from "@/components/movement-figure/movement-figure";
import { BodyMap, type MuscleRole } from "@/components/movement-figure/body-map";
import { formatDate, shortDate } from "@/lib/dates";
import { weightUnit } from "@/lib/units";
import { equipmentLabels, muscleLabels, type MuscleGroup } from "@/lib/muscles";
import { cn } from "@/lib/utils";
import { progressionQueryOptions } from "../_layout.workout-history/-queries/workout-history";
import { movementQueryOptions } from "./-queries/movements";

export const Route = createFileRoute("/__index/_layout/movements/$movementId")({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(movementQueryOptions(params.movementId));
  },
  component: MovementPage,
});

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function MovementPage() {
  const { movementId } = Route.useParams();
  const { timeZone } = Route.useRouteContext();
  const { data } = useSuspenseQuery(movementQueryOptions(movementId));
  const [step, setStep] = useState(0);
  // Not found, or another user's: the same answer, so a stranger cannot tell the two apart.
  if (!data) {
    return (
      <div className="space-y-4 pt-6">
        <p className="text-lg font-semibold text-chalk">That movement doesn't exist.</p>
        <Link to="/movements" className="text-accent underline-offset-4 hover:underline">
          Back to the library
        </Link>
      </div>
    );
  }
  const movement = data;
  const figure = movement.guide?.figure ?? null;

  const roles: Partial<Record<MuscleGroup, MuscleRole>> = {};
  const levels: Partial<Record<MuscleGroup, number>> = {};
  for (const m of movement.secondaryMuscles) {
    roles[m] = "secondary";
    levels[m] = 0.5;
  }
  for (const m of movement.primaryMuscles) {
    roles[m] = "primary";
    levels[m] = 1;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={movement.isBuiltIn ? "Movement" : "Your movement"}
        title={movement.name}
        actions={
          <Link
            to="/movements"
            className="press inline-flex h-11 items-center gap-2 rounded-full border border-line-strong bg-white/[0.04] px-5 text-sm font-medium text-chalk hover:bg-white/[0.09]">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All movements
          </Link>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-6">
          {figure ? (
            <Card className="enter enter-1 p-3 sm:p-4">
              <MovementFigure
                name={movement.name}
                figure={figure}
                primary={movement.primaryMuscles}
                secondary={movement.secondaryMuscles}
                onStepChange={setStep}
              />
            </Card>
          ) : (
            <Card className="enter enter-1 p-5 sm:p-7">
              <p className="eyebrow">Animation</p>
              <p className="mt-2 text-sm text-muted">
                {movement.guide
                  ? "There is no animation for this movement yet. The muscles and the steps are on the right."
                  : "This is a movement you created, so there is no guide for it. Its muscles are on the right."}
              </p>
            </Card>
          )}
          <YourNumbers movementId={movementId} timeZone={timeZone} />
        </div>

        <Card className="enter enter-2 space-y-5 p-3 sm:p-4 lg:p-5">
          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-1.5" aria-label="About this movement">
              {movement.equipment && <Tag>{equipmentLabels[movement.equipment]}</Tag>}
              {movement.isBodyWeight && <Tag tone="ok">Body weight</Tag>}
              {!movement.isBuiltIn && <Tag>Yours</Tag>}
            </div>
          </div>

          <BodyMap levels={levels} roles={roles} label={`Muscles worked by ${movement.name}`} />

          <MuscleList title="Primary" muscles={movement.primaryMuscles} tone="primary" />
          <MuscleList title="Secondary" muscles={movement.secondaryMuscles} tone="secondary" />

          {movement.guide && (
            <>
              <div>
                <h2 className="eyebrow mb-2">How to do it</h2>
                <ol className="grid gap-1.5">
                  {movement.guide.steps.map((text, i) => (
                    <li
                      key={i}
                      data-step={i}
                      data-on={figure && i === step ? "true" : "false"}
                      className={cn(
                        "grid grid-cols-[1.625rem_1fr] items-start gap-2.5 rounded-2xl border border-transparent px-2.5 py-2 text-sm text-muted transition-colors",
                        figure && i === step && "border-line-strong bg-well text-chalk",
                      )}>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid h-6 w-6 place-items-center rounded-full text-xs font-bold transition-colors",
                          figure && i === step ? "bg-primary text-primary-ink" : "bg-well text-faint",
                        )}>
                        {i + 1}
                      </span>
                      <span>{text}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <p className="border-l-2 border-ok pl-3 text-sm text-muted">
                <b className="font-semibold text-ok">Watch for</b> {movement.guide.watch}
              </p>
            </>
          )}
        </Card>
      </div>
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
      <h2 className="eyebrow mb-2">{title}</h2>
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

/** The user's own history with this movement, from the same query as the progression chart and the set composer. */
function YourNumbers({ movementId, timeZone }: { movementId: string; timeZone: string }) {
  const { data } = useQuery(progressionQueryOptions(movementId, timeZone));
  const last = data?.days.at(-1);
  const best = data && data.days.length ? Math.max(...data.days.map((d) => d.maxWeight)) : null;

  return (
    <Card className="enter enter-3 p-5 sm:p-7">
      <p className="eyebrow">Your numbers</p>
      {!data ? (
        <p className="mt-2 min-h-5 text-sm text-faint"> </p>
      ) : !last ? (
        <p className="mt-2 text-sm text-muted">You haven't logged this movement yet.</p>
      ) : (
        <dl className="num mt-3 grid grid-cols-2 gap-4">
          <div>
            <dt className="eyebrow">Last top set</dt>
            <dd className="mt-1 text-2xl font-bold tracking-tight text-chalk font-stretch-[88%]">
              {numberFormat.format(last.maxWeight)} <span className="text-sm font-medium text-muted">{weightUnit}</span>
            </dd>
            <dd className="text-xs text-faint">{formatDate(`${last.day}T12:00:00Z`, "UTC", shortDate)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Best</dt>
            <dd className="mt-1 text-2xl font-bold tracking-tight text-chalk font-stretch-[88%]">
              {numberFormat.format(best!)} <span className="text-sm font-medium text-muted">{weightUnit}</span>
            </dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
