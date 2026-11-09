import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { maxExercisesPerPreset } from "@/lib/presets";
import { movementsByIdQueryOptions } from "./-queries/presets";
import { newExercise, PresetEditor, type Draft } from "./-preset-editor";

type NewSearch = { movements: string | undefined };

export const Route = createFileRoute("/__index/_layout/workout-library/new")({
  // The movements ticked on the Movements page arrive as a comma separated list of ids.
  validateSearch: (search: Record<string, unknown>): NewSearch => ({
    movements: typeof search.movements === "string" ? search.movements : undefined,
  }),
  loaderDeps: ({ search }) => ({ ids: parseIds(search.movements) }),
  loader: async ({ context, deps }) => {
    if (deps.ids.length > 0) await context.queryClient.ensureQueryData(movementsByIdQueryOptions(deps.ids));
  },
  component: NewWorkoutPage,
});

const parseIds = (value: string | undefined) =>
  (value ?? "").split(",").filter(Boolean).slice(0, maxExercisesPerPreset);

function NewWorkoutPage() {
  const { movements: param } = Route.useSearch();
  const ids = parseIds(param);
  const { data: movements } = useSuspenseQuery(
    ids.length > 0
      ? movementsByIdQueryOptions(ids)
      : { queryKey: ["presets", "movements", []], queryFn: async () => [] },
  );
  const initial: Draft = {
    name: "",
    weekdays: [],
    // Deterministic keys for the first render, so the server and the browser agree.
    exercises: movements.map((m, i) => newExercise(m, `n${i}`)),
  };
  return <PresetEditor presetId={null} initial={initial} />;
}
