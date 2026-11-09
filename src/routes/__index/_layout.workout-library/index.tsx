import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Pencil, Play, Plus } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { WorkoutCard } from "@/components/workout-card";
import { presetsQueryOptions } from "./-queries/presets";

export const Route = createFileRoute("/__index/_layout/workout-library/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(presetsQueryOptions());
  },
  component: WorkoutLibraryPage,
});

/** The user's saved workouts. Each one starts from here or from the home screen when it is a workout of the day. */
function WorkoutLibraryPage() {
  const { data: presets } = useSuspenseQuery(presetsQueryOptions());

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Library"
        title="Workout Library"
        actions={
          <Link to="/workout-library/new" search={{ movements: undefined }} className={buttonClasses()}>
            <Plus className="h-4 w-4" />
            New workout
          </Link>
        }
      />

      {presets.length === 0 ? (
        <div className="glass enter enter-1 space-y-4 rounded-panel px-6 py-12 text-center">
          <p className="text-lg font-semibold text-chalk">No workouts yet</p>
          <p className="mx-auto max-w-md text-sm text-muted">
            Build a workout once, with the movements, the series and the rest, and start it whenever you train. You can
            also pick the days it is the workout of the day.
          </p>
          <Link to="/workout-library/new" search={{ movements: undefined }} className={buttonClasses({ size: "lg" })}>
            <Plus className="h-4 w-4" />
            Create your first workout
          </Link>
        </div>
      ) : (
        <ul className="enter enter-1 space-y-3" aria-label="Your workouts">
          {presets.map((preset) => (
            <li key={preset.id}>
              <WorkoutCard
                workout={preset}
                actions={
                  <>
                    <Link
                      to="/workout-library/$presetId"
                      params={{ presetId: preset.id }}
                      aria-label={`Edit ${preset.name}`}
                      className={buttonClasses({ variant: "ghost", size: "icon" })}>
                      <Pencil className="h-4 w-4" />
                    </Link>
                    <Link
                      to="/start-workout"
                      search={{ preset: preset.id, from: undefined }}
                      aria-label={`Start ${preset.name}`}
                      className={buttonClasses({ variant: "secondary", size: "sm" })}>
                      <Play className="h-3.5 w-3.5 fill-current" />
                      Start
                    </Link>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
