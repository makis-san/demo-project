import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient } from "@/lib/db.server";
import { authMiddleware } from "@/lib/auth.server";
import { errorMiddleware } from "@/lib/errors.server";
import { resolveTimeZone } from "@/lib/request-timezone.server";
import { primarySetWeight, secondarySetWeight, type MuscleGroup } from "@/lib/muscles";
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

export type MovementBest = {
  movementId: string;
  /** The heaviest weight of the movement's most recent day. */
  lastTop: number;
  /** The reps of that top set, to start the next one from. */
  lastTopReps: number;
  /** That day in the user's timezone, as YYYY-MM-DD. */
  lastDay: string;
  /** The heaviest weight ever lifted for the movement. */
  best: number;
};

/**
 * What the current workout needs from each movement's history, for the "last time" hint and the PR badges: the top
 * weight of the last day it was trained, that day, and the best weight ever. Two numbers and a date per movement,
 * where the chart's query returns every day and workout. One request answers for every movement in the workout.
 *
 * It follows the chart's rules, so the numbers are the same ones: completed workouts only, and a day is the day the
 * workout was completed in the user's timezone. A movement that was never trained has no row, which the page reads as
 * "first time". Another user's movement id just has no row, because the sets are filtered by the workout's owner.
 */
export const getMovementBestsServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ movementIds: z.array(z.string()).max(200) }))
  .handler(
    async ({
      context,
      data,
    }: {
      context: { user: { id: string } };
      data: { movementIds: string[] };
    }): Promise<MovementBest[]> => {
      if (data.movementIds.length === 0) return [];
      const prisma = await getServerSidePrismaClient();
      const timeZone = resolveTimeZone();
      // One row per movement and day first, then DISTINCT ON keeps the newest day of each movement. The window MAX runs
      // before DISTINCT ON picks a row, so `best` still covers every day, not only the newest.
      return prisma.$queryRaw<MovementBest[]>`
        WITH days AS (
          SELECT
            s."movementId",
            (w."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date AS "day",
            MAX(s."weight") AS "topWeight",
            (ARRAY_AGG(s."reps" ORDER BY s."weight" DESC, s."createdAt" DESC))[1] AS "topReps"
          FROM "Set" s
          JOIN "Workout" w ON w."id" = s."workoutId"
          WHERE w."userId" = ${context.user.id}
            AND s."movementId" = ANY(${data.movementIds}::text[])
            AND w."completedAt" IS NOT NULL
          GROUP BY s."movementId", 2
        )
        SELECT DISTINCT ON ("movementId")
          "movementId",
          "topWeight"::float8 AS "lastTop",
          "topReps"::int AS "lastTopReps",
          to_char("day", 'YYYY-MM-DD') AS "lastDay",
          (MAX("topWeight") OVER (PARTITION BY "movementId"))::float8 AS "best"
        FROM days
        ORDER BY "movementId", "day" DESC
      `;
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

export type MuscleLoad = {
  /** The first day of the window and today, in the user's timezone, as YYYY-MM-DD. */
  from: string;
  today: string;
  /** Sets per muscle group over the window. Only groups that were trained appear. */
  muscles: { muscle: MuscleGroup; sets: number }[];
  /** Every set in the window, and how many of them were on a movement with no muscles (custom ones can have none). */
  totalSets: number;
  uncountedSets: number;
};

/** How many days the muscle view covers: today and the six days before it. */
export const muscleLoadDays = 7;

/**
 * Which muscles the last 7 days trained, for the history page. Each set of a completed workout gives 1 set to every
 * primary muscle of its movement and half a set to every secondary muscle (`primarySetWeight`, `secondarySetWeight`),
 * which is a common convention and easy to explain. The arithmetic is one SQL query: the muscle arrays are unnested
 * and grouped, so nothing is fetched to be added up in JavaScript.
 *
 * - The window is 7 calendar days in the user's timezone ending today, starting at that day's local midnight,
 *   like the calendar and the charts. A set from an active workout does not count until the workout is completed.
 * - A set on a movement with no primary muscle adds nothing, and is counted in `uncountedSets` so the page can say so.
 */
export const getMuscleLoadServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }: { context: { user: { id: string } } }): Promise<MuscleLoad> => {
    const prisma = await getServerSidePrismaClient();
    const timeZone = resolveTimeZone();
    const back = muscleLoadDays - 1;
    const [muscles, [{ from, today, totalSets, uncountedSets }]] = await prisma.$transaction([
      prisma.$queryRaw<{ muscle: MuscleGroup; sets: number }[]>`
        SELECT x."muscle"::text AS "muscle", SUM(x."weight")::float8 AS "sets"
        FROM "Set" s
        JOIN "Workout" w ON w."id" = s."workoutId"
        JOIN "Movement" m ON m."id" = s."movementId"
        CROSS JOIN LATERAL (
          SELECT unnest(m."primaryMuscles") AS "muscle", ${primarySetWeight}::numeric AS "weight"
          UNION ALL
          SELECT unnest(m."secondaryMuscles"), ${secondarySetWeight}::numeric
        ) x
        WHERE w."userId" = ${context.user.id}
          AND w."completedAt" IS NOT NULL
          AND (w."completedAt" AT TIME ZONE 'UTC') >=
            (((now() AT TIME ZONE ${timeZone})::date - ${back}::int)::timestamp AT TIME ZONE ${timeZone})
        GROUP BY x."muscle"
        ORDER BY 2 DESC, 1
      `,
      prisma.$queryRaw<{ from: string; today: string; totalSets: number; uncountedSets: number }[]>`
        SELECT
          to_char((now() AT TIME ZONE ${timeZone})::date - ${back}::int, 'YYYY-MM-DD') AS "from",
          to_char((now() AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS "today",
          COUNT(s."id")::int AS "totalSets",
          (COUNT(s."id") FILTER (WHERE cardinality(m."primaryMuscles") = 0))::int AS "uncountedSets"
        FROM (SELECT 1) one
        LEFT JOIN "Workout" w
          ON w."userId" = ${context.user.id}
          AND w."completedAt" IS NOT NULL
          AND (w."completedAt" AT TIME ZONE 'UTC') >=
            (((now() AT TIME ZONE ${timeZone})::date - ${back}::int)::timestamp AT TIME ZONE ${timeZone})
        LEFT JOIN "Set" s ON s."workoutId" = w."id"
        LEFT JOIN "Movement" m ON m."id" = s."movementId"
      `,
    ]);
    return { from, today, muscles, totalSets, uncountedSets };
  });
