import { getMovementServerFn, getMovementsServerFn } from "@/lib/movements.server";
import { queryOptions } from "@tanstack/react-query";

// Starts every movement key, so invalidating it refreshes the list and any open movement page.
export const movementsQueryKey = ["movements"] as const;

export const movementsQueryOptions = () =>
  queryOptions({
    queryKey: movementsQueryKey,
    queryFn: () => getMovementsServerFn(),
  });

export const movementQueryOptions = (movementId: string) =>
  queryOptions({
    queryKey: [...movementsQueryKey, movementId],
    queryFn: () => getMovementServerFn({ data: { movementId } }),
  });
