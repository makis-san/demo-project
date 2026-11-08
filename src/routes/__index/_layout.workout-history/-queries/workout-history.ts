import { getWorkoutHistoryServerFn } from "@/lib/workouts.server";
import { getProgressionServerFn } from "@/lib/progression.server";
import { queryOptions } from "@tanstack/react-query";

export const workoutHistoryQueryOptions = () =>
  queryOptions({
    queryKey: ["workout-history"],
    queryFn: () => getWorkoutHistoryServerFn(),
  });

// The server groups days in the user's timezone, so the timezone is part of the
// key. When the browser sets its timezone cookie the key changes and the data is fetched again.
export const progressionQueryOptions = (movementId: string, timeZone: string) =>
  queryOptions({
    queryKey: ["progression", movementId, timeZone],
    queryFn: () => getProgressionServerFn({ data: { movementId } }),
  });
