import {
  getMovementsByIdServerFn,
  getPresetServerFn,
  getPresetsServerFn,
  getTodayServerFn,
  getWorkoutPreviewServerFn,
} from "@/lib/presets.server";
import { queryOptions } from "@tanstack/react-query";

// Starts every preset key, so invalidating it refreshes the library, one preset, the day's workouts and the start
// screen together. Saving, deleting and completing a workout (which marks a workout of the day as done) all do.
export const presetsQueryKey = ["presets"] as const;

export const presetsQueryOptions = () =>
  queryOptions({ queryKey: [...presetsQueryKey, "list"], queryFn: () => getPresetsServerFn() });

export const presetQueryOptions = (presetId: string) =>
  queryOptions({
    queryKey: [...presetsQueryKey, "one", presetId],
    queryFn: () => getPresetServerFn({ data: { presetId } }),
  });

// The timezone is in the key: the weekday is the user's own.
export const todayQueryOptions = (timeZone: string) =>
  queryOptions({ queryKey: [...presetsQueryKey, "today", timeZone], queryFn: () => getTodayServerFn() });

export const previewQueryOptions = (presetId: string | null, fromWorkoutId: string | null) =>
  queryOptions({
    queryKey: [...presetsQueryKey, "preview", presetId, fromWorkoutId],
    queryFn: () => getWorkoutPreviewServerFn({ data: { presetId, fromWorkoutId } }),
  });

export const movementsByIdQueryOptions = (ids: string[]) =>
  queryOptions({
    queryKey: [...presetsQueryKey, "movements", ids],
    queryFn: () => getMovementsByIdServerFn({ data: { ids } }),
  });
