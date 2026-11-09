import { queryOptions } from "@tanstack/react-query";
import { getSessionsServerFn } from "@/lib/sessions.server";

export const sessionsQueryOptions = () =>
  queryOptions({
    queryKey: ["sessions"],
    queryFn: () => getSessionsServerFn(),
  });
