import { getCurrentWorkoutServerFn } from "@/lib/workouts.server";
import { searchMovementsServerFn } from "@/lib/movements.server";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { movementsQueryKey } from "../../_layout.movements/-queries/movements";

export const currentWorkoutQueryOptions = () =>
  queryOptions({
    queryKey: ["current-workout"],
    queryFn: () => getCurrentWorkoutServerFn(),
  });

// One entry per page of the picker, per search text. Under the movements key, so creating a movement refreshes it.
export const movementSearchQueryOptions = (search: string) =>
  infiniteQueryOptions({
    queryKey: [...movementsQueryKey, "search", search],
    queryFn: ({ pageParam }) => searchMovementsServerFn({ data: { search, cursor: pageParam } }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
