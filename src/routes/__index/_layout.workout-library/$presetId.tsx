import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { presetQueryOptions } from "./-queries/presets";
import type { Draft } from "./-preset-editor";
import { PresetEditor } from "./-preset-editor";

export const Route = createFileRoute("/__index/_layout/workout-library/$presetId")({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(presetQueryOptions(params.presetId));
  },
  component: EditWorkoutPage,
});

function EditWorkoutPage() {
  const { presetId } = Route.useParams();
  const { data: preset } = useSuspenseQuery(presetQueryOptions(presetId));
  // Not found, or another user's: the same answer.
  if (!preset) {
    return (
      <div className="space-y-4 pt-6">
        <p className="text-lg font-semibold text-chalk">That workout doesn't exist.</p>
        <Link to="/workout-library" className="text-accent underline-offset-4 hover:underline">
          Back to your workouts
        </Link>
      </div>
    );
  }
  const initial: Draft = {
    name: preset.name,
    weekdays: preset.weekdays,
    exercises: preset.exercises.map((e) => ({
      key: e.id,
      movement: e.movement,
      restSeconds: String(e.restSeconds),
      sets: e.sets.map((s) => ({ key: s.id, reps: String(s.reps), weight: s.weight === null ? "" : String(s.weight) })),
    })),
  };
  // Keyed by the preset, so opening another one starts a fresh editor.
  return <PresetEditor key={preset.id} presetId={preset.id} initial={initial} />;
}
