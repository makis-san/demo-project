import { createServerFn } from "@tanstack/react-start";
import { resolveTimeZone } from "./request-timezone.server";

/** The timezone the server renders dates in for this request. See resolveTimeZone. */
export const getTimeZoneServerFn = createServerFn().handler(async () => resolveTimeZone());
