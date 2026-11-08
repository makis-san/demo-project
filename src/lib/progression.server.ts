import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient } from "@/lib/db.server";
import { authMiddleware } from "@/lib/auth.server";
import { errorMiddleware } from "@/lib/errors.server";
import { resolveTimeZone } from "@/lib/request-timezone.server";
import { z } from "zod";

export type ProgressionDay = {
  /** The day in the user's timezone, as YYYY-MM-DD. */
  day: string;
  maxWeight: number;
};

export type ProgressionWorkout = {
  /** The day in the user's timezone, as YYYY-MM-DD, so the page can tell which workouts share a day. */
  day: string;
  completedAt: Date;
  totalReps: number;
  totalVolume: number;
};

export type ProgressionData = {
  /** One row per day, oldest first. */
  days: ProgressionDay[];
  /** One row per workout, oldest first. */
  workouts: ProgressionWorkout[];
};

/**
 * The data for one movement's chart, in the grain the README gives each metric, so switching metric in the page
 * needs no new request.
 *
 * - Max weight is "on a given day", so it has one row per day: the heaviest weight of the day, even when there
 *   were two workouts.
 * - Total reps and total volume are "in a workout", so they have one row per workout, with the time it was
 *   completed. Two workouts on one day are two rows.
 * - Only completed workouts count, the same ones the history page lists.
 * - A day is the day the workout was completed, in the user's timezone (from the cookie, the same one the history
 *   page uses for dates).
 * - Volume is weight x reps summed in the database, where decimals are exact, and converted to a plain number
 *   only at the end.
 * - Both queries run in one transaction, so they see the same workouts.
 */
export const getProgressionServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ movementId: z.string() }))
  .handler(
    async ({
      context,
      data,
    }: {
      context: { user: { id: string } };
      data: { movementId: string };
    }): Promise<ProgressionData> => {
      const prisma = await getServerSidePrismaClient();
      const timeZone = resolveTimeZone();
      // completedAt is stored as UTC without a zone. Mark it as UTC first, then convert to the user's zone.
      const [days, workouts] = await prisma.$transaction([
        prisma.$queryRaw<ProgressionDay[]>`
          SELECT
            to_char((w."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS "day",
            MAX(s."weight")::float8 AS "maxWeight"
          FROM "Set" s
          JOIN "Workout" w ON w."id" = s."workoutId"
          WHERE w."userId" = ${context.user.id}
            AND s."movementId" = ${data.movementId}
            AND w."completedAt" IS NOT NULL
          GROUP BY 1
          ORDER BY 1
        `,
        prisma.$queryRaw<ProgressionWorkout[]>`
          SELECT
            to_char((w."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS "day",
            w."completedAt" AS "completedAt",
            SUM(s."reps")::int AS "totalReps",
            SUM(s."weight" * s."reps")::float8 AS "totalVolume"
          FROM "Set" s
          JOIN "Workout" w ON w."id" = s."workoutId"
          WHERE w."userId" = ${context.user.id}
            AND s."movementId" = ${data.movementId}
            AND w."completedAt" IS NOT NULL
          GROUP BY w."id", w."completedAt"
          ORDER BY w."completedAt", w."id"
        `,
      ]);
      return { days, workouts };
    },
  );

export type CalendarDay = {
  /** The day in the user's timezone, as YYYY-MM-DD. */
  day: string;
  workouts: number;
  sets: number;
  volume: number;
};

export type TrainingCalendar = {
  /** Today in the user's timezone, as YYYY-MM-DD, so the page lays out the weeks without trusting the clock. */
  today: string;
  /** Only days with a completed workout, oldest first. */
  days: CalendarDay[];
};

/** How many days back the calendar goes: 18 weeks, so a phone shows a full grid and a desktop four months. */
export const calendarDays = 18 * 7;

/**
 * Completed workouts per day over the last `calendarDays` days, for the training calendar on the history page.
 * Days are grouped in the user's timezone, the same way as the progression chart, so a late workout lands on the
 * user's own day. A workout without sets still counts as a day trained.
 */
export const getTrainingCalendarServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }: { context: { user: { id: string } } }): Promise<TrainingCalendar> => {
    const prisma = await getServerSidePrismaClient();
    const timeZone = resolveTimeZone();
    const [[{ today }], days] = await prisma.$transaction([
      prisma.$queryRaw<{ today: string }[]>`
        SELECT to_char((now() AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS "today"
      `,
      prisma.$queryRaw<CalendarDay[]>`
        SELECT
          to_char(local.day, 'YYYY-MM-DD') AS "day",
          COUNT(DISTINCT w."id")::int AS "workouts",
          COUNT(s."id")::int AS "sets",
          COALESCE(SUM(s."weight" * s."reps"), 0)::float8 AS "volume"
        FROM "Workout" w
        CROSS JOIN LATERAL (
          SELECT (w."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date AS day
        ) local
        LEFT JOIN "Set" s ON s."workoutId" = w."id"
        WHERE w."userId" = ${context.user.id}
          AND w."completedAt" IS NOT NULL
          AND local.day > (now() AT TIME ZONE ${timeZone})::date - ${calendarDays}::int
        GROUP BY local.day
        ORDER BY local.day
      `,
    ]);
    return { today, days };
  });
