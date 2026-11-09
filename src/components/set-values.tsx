import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateSetServerFn } from "@/lib/workouts.server";
import { repsSchema, weightSchema } from "@/lib/validation";
import { weightUnit } from "@/lib/units";
import { currentWorkoutQueryOptions } from "@/routes/__index/_layout.current-workout/-queries/current-workout";
import {
  progressionQueryKey,
  workoutHistoryQueryKey,
} from "@/routes/__index/_layout.workout-history/-queries/workout-history";

/**
 * Saves an edited set. Everything that is computed from sets reads them again afterwards: the current workout, the
 * history table, calendar and muscle view (they share the history key), and the progression charts and PRs.
 * `onSettled` and not `onError` for the refresh, so a refused edit (for example the workout was deleted in another
 * tab) still reloads the page, while the router's own error toast still shows.
 */
export function useUpdateSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { setId: string; reps: number; weight: number }) => {
      const result = await updateSetServerFn({ data: input });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: currentWorkoutQueryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: workoutHistoryQueryKey });
      queryClient.invalidateQueries({ queryKey: progressionQueryKey });
    },
  });
}

/**
 * A set's reps and weight, shown as text that turns into two fields in place when tapped. The movement and the
 * place in the list do not change. The fields check the same rules as adding a set (`repsSchema`, `weightSchema`),
 * and the server checks them again, so there is one rule for what a valid set is.
 */
export function SetValues({
  set,
  className,
}: {
  set: { id: string; reps: number; weight: number; movement: { name: string } };
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [reps, setReps] = useState("");
  const [weight, setWeight] = useState("");
  const update = useUpdateSet();

  const repsResult = repsSchema.safeParse(reps === "" ? NaN : Number(reps));
  const weightResult = weightSchema.safeParse(weight === "" ? NaN : Number(weight));
  const error = !repsResult.success
    ? `Reps: ${repsResult.error.issues[0]?.message ?? "invalid"}`
    : !weightResult.success
      ? `Weight: ${weightResult.error.issues[0]?.message ?? "invalid"}`
      : null;
  const unchanged = Number(reps) === set.reps && Number(weight) === set.weight;

  const start = () => {
    setReps(String(set.reps));
    setWeight(String(set.weight));
    setEditing(true);
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (error) return;
    if (unchanged) return setEditing(false);
    update.mutate(
      { setId: set.id, reps: Number(reps), weight: Number(weight) },
      { onSuccess: () => setEditing(false) },
    );
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        aria-label={`Edit ${set.movement.name} set: ${set.reps} × ${set.weight} ${weightUnit}`}
        className={`num press min-w-0 flex-1 cursor-text rounded-xl py-1 text-left text-sm whitespace-nowrap text-muted hover:bg-white/[0.05] ${className ?? ""}`}>
        <span className="text-lg font-bold text-chalk">{set.reps}</span> reps ×{" "}
        <span className="text-lg font-bold text-chalk">{set.weight}</span> {weightUnit}
      </button>
    );
  }

  return (
    <form onSubmit={save} className="min-w-0 flex-1 basis-full space-y-1.5 py-1 sm:basis-auto">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          aria-label={`Reps for ${set.movement.name}`}
          inputMode="numeric"
          min={1}
          max={1000}
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          autoFocus
          className="num h-11 w-20 text-center text-base"
        />
        <span className="text-sm text-muted">reps ×</span>
        <Input
          type="number"
          aria-label={`Weight for ${set.movement.name}`}
          inputMode="decimal"
          min={0}
          max={9999.99}
          step="0.01"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          className="num h-11 w-28 text-center text-base"
        />
        <span className="text-sm text-muted">{weightUnit}</span>
        <Button
          type="submit"
          size="icon"
          disabled={!!error || update.isPending}
          aria-label="Save set"
          className="h-11 w-11">
          <Check className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Cancel edit"
          onClick={() => setEditing(false)}
          className="h-11 w-11">
          <X className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="px-1 text-xs text-danger">{error}</p>}
    </form>
  );
}
