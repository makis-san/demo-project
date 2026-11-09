import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Pencil, Play, Plus } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { LibrarySwitch } from "@/components/library-switch";
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
      <LibrarySwitch current="workouts" />
      <PageHeader
        title="Workout Library"
        actions={
          presets.length > 0 && (
            <Link to="/workout-library/new" search={{ movements: undefined }} className={buttonClasses({ size: "sm" })}>
              <Plus className="h-4 w-4" />
              New workout
            </Link>
          )
        }
      />

      {presets.length === 0 ? (
        <div className="enter enter-1 flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-base text-muted">No workouts yet.</p>
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
                topAction={
                  <Link
                    to="/workout-library/$presetId"
                    params={{ presetId: preset.id }}
                    aria-label={`Edit ${preset.name}`}
                    className={buttonClasses({ variant: "ghost", size: "icon" })}>
                    <Pencil className="h-4 w-4" />
                  </Link>
                }
                actions={
                  <Link
                    to="/start-workout"
                    search={{ preset: preset.id, from: undefined }}
                    aria-label={`Start ${preset.name}`}
                    className={buttonClasses({ variant: "secondary", size: "sm" })}>
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Start
                  </Link>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
