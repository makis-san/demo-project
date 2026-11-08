-- Workouts never recorded when they started. Existing rows get their
-- completion time when they have one, otherwise the time of this migration.
ALTER TABLE "Workout" ADD COLUMN "startedAt" TIMESTAMP(3);

UPDATE "Workout" SET "startedAt" = COALESCE("completedAt", CURRENT_TIMESTAMP);

ALTER TABLE "Workout"
  ALTER COLUMN "startedAt" SET NOT NULL,
  ALTER COLUMN "startedAt" SET DEFAULT CURRENT_TIMESTAMP;
