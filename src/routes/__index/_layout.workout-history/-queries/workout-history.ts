import {
  getHistoryMovementsServerFn,
  getLastWorkoutServerFn,
  getWorkoutHistoryServerFn,
  type HistoryCursor,
} from "@/lib/workouts.server";
import {
  getMovementBestsServerFn,
  getMuscleLoadServerFn,
  getProgressionServerFn,
  getTrainingCalendarServerFn,
} from "@/lib/progression.server";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

// Starts every history key, so invalidating it refreshes the pages and the movement list together.
export const workoutHistoryQueryKey = ["workout-history"] as const;

// One entry per page. Refetching asks for the first page again and works out where each next page
// starts from the page before it, so a workout completed or deleted meanwhile does not skip or repeat one.
export const workoutHistoryQueryOptions = () =>
  infiniteQueryOptions({
    queryKey: [...workoutHistoryQueryKey, "pages"],
    queryFn: ({ pageParam }) => getWorkoutHistoryServerFn({ data: { cursor: pageParam } }),
    initialPageParam: null as HistoryCursor | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

export const historyMovementsQueryOptions = () =>
  queryOptions({
    queryKey: [...workoutHistoryQueryKey, "movements"],
    queryFn: () => getHistoryMovementsServerFn(),
  });

// The server groups days in the user's timezone, so the timezone is part of the
// key. When the browser sets its timezone cookie the key changes and the data is fetched again.
// Starts every progression key, so invalidating it refreshes the chart for any movement.
export const progressionQueryKey = ["progression"] as const;

export const progressionQueryOptions = (movementId: string, timeZone: string) =>
  queryOptions({
    queryKey: [...progressionQueryKey, movementId, timeZone],
    queryFn: () => getProgressionServerFn({ data: { movementId } }),
  });

// The last top set and the best of several movements, for the current workout's hint and PR badges. Under the
// progression key on purpose: everything that refreshes the charts (completing or deleting a workout, editing a set)
// refreshes this too, with no second place to remember. The ids are sorted so the same movements always share a key.
export const movementBestsQueryOptions = (movementIds: string[], timeZone: string) =>
  queryOptions({
    queryKey: [...progressionQueryKey, "bests", [...movementIds].sort(), timeZone],
    queryFn: () => getMovementBestsServerFn({ data: { movementIds } }),
  });

// Under the history key, so completing or deleting a workout refreshes it with the list. The timezone is in the
// key for the same reason as the chart's.
export const trainingCalendarQueryOptions = (timeZone: string) =>
  queryOptions({
    queryKey: [...workoutHistoryQueryKey, "calendar", timeZone],
    queryFn: () => getTrainingCalendarServerFn(),
  });

// Under the history key too, so completing, deleting or editing sets refreshes it. The timezone is in the key
// because the 7-day window starts at the user's local midnight.
export const muscleLoadQueryOptions = (timeZone: string) =>
  queryOptions({
    queryKey: [...workoutHistoryQueryKey, "muscles", timeZone],
    queryFn: () => getMuscleLoadServerFn(),
  });

// The latest completed workout, for the home screen. Under the history key, so completing or deleting a workout
// refreshes it with the list.
export const lastWorkoutQueryOptions = () =>
  queryOptions({
    queryKey: [...workoutHistoryQueryKey, "last"],
    queryFn: () => getLastWorkoutServerFn(),
  });
