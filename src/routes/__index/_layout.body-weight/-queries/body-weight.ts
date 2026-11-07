import { getBodyWeightsServerFn, getLatestBodyWeightServerFn } from "@/lib/body-weight.server";
import { queryOptions } from "@tanstack/react-query";

export const bodyWeightQueryOptions = () =>
  queryOptions({
    queryKey: ["body-weight"],
    queryFn: () => getBodyWeightsServerFn(),
  });

// Starts with the list's key, so invalidating ["body-weight"] refreshes both.
export const latestBodyWeightQueryOptions = () =>
  queryOptions({
    queryKey: ["body-weight", "latest"],
    queryFn: () => getLatestBodyWeightServerFn(),
  });
