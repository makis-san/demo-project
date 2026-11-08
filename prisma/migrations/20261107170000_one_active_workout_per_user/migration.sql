-- A user may have only one active (not completed) workout. Prisma cannot
-- express a partial unique index in the schema, so it is written here. Prisma
-- leaves it alone when it compares the database to the schema.
--
-- Some users already have several active workouts. Keep one per user: the
-- most recently started, then the one with the most sets, then the highest id.
-- (Old rows all share the migration time as their start, so in practice the
-- one with the most sets wins.) Other active workouts that have sets are
-- completed at their start time so no data is lost. Empty ones are deleted.

CREATE TEMP TABLE "_extra_active_workout" AS
SELECT "id", "set_count"
FROM (
  SELECT
    w."id",
    (SELECT COUNT(*) FROM "Set" s WHERE s."workoutId" = w."id") AS "set_count",
    ROW_NUMBER() OVER (
      PARTITION BY w."userId"
      ORDER BY
        w."startedAt" DESC,
        (SELECT COUNT(*) FROM "Set" s WHERE s."workoutId" = w."id") DESC,
        w."id" DESC
    ) AS "rn"
  FROM "Workout" w
  WHERE w."completedAt" IS NULL
) ranked
WHERE "rn" > 1;

DELETE FROM "Workout"
WHERE "id" IN (SELECT "id" FROM "_extra_active_workout" WHERE "set_count" = 0);

UPDATE "Workout"
SET "completedAt" = "startedAt"
WHERE "id" IN (SELECT "id" FROM "_extra_active_workout" WHERE "set_count" > 0);

DROP TABLE "_extra_active_workout";

CREATE UNIQUE INDEX "Workout_one_active_per_user" ON "Workout"("userId") WHERE "completedAt" IS NULL;
