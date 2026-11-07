import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient } from "@/lib/db.server";
import { authMiddleware } from "@/lib/auth.server";
import { errorMiddleware } from "@/lib/errors.server";
import { resolveTimeZone } from "@/lib/request-timezone.server";
import { z } from "zod";

export type ProgressionRow = {
  /** The day in the user's timezone, as YYYY-MM-DD. */
  day: string;
  maxWeight: number;
  totalReps: number;
  totalVolume: number;
};

/**
 * One row per day for one movement, with all three metrics, so switching
 * metric in the page needs no new request.
 *
 * - Only completed workouts count, the same ones the history page lists.
 * - A set belongs to the day its workout was completed, in the user's
 *   timezone (from the cookie, the same one the history page uses for dates).
 * - Two workouts on one day are combined into one point: the heaviest weight of
 *   the day, all reps of the day, and all volume of the day.
 * - Volume is weight x reps summed in the database, where decimals are exact,
 *   and converted to a plain number only at the end.
 */
export const getProgressionServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ movementId: z.string() }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { movementId: string } }) => {
    const prisma = await getServerSidePrismaClient();
    const timeZone = resolveTimeZone();
    // completedAt is stored as UTC without a zone. Mark it as UTC first, then convert to the user's zone.
    return prisma.$queryRaw<ProgressionRow[]>`
      SELECT
        to_char((w."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS "day",
        MAX(s."weight")::float8 AS "maxWeight",
        SUM(s."reps")::int AS "totalReps",
        SUM(s."weight" * s."reps")::float8 AS "totalVolume"
      FROM "Set" s
      JOIN "Workout" w ON w."id" = s."workoutId"
      WHERE w."userId" = ${context.user.id}
        AND s."movementId" = ${data.movementId}
        AND w."completedAt" IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `;
  });
