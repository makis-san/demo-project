import { getBodyWeightsServerFn } from "@/lib/body-weight.server";
import { queryOptions } from "@tanstack/react-query";

export const bodyWeightQueryOptions = () =>
  queryOptions({
    queryKey: ["body-weight"],
    queryFn: () => getBodyWeightsServerFn(),
  });
