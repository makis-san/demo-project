-- The timeline of a workout: the movement sections and the pauses behind the ring on the current workout page.
-- AlterTable
ALTER TABLE "Workout" ADD COLUMN     "timeline" JSONB;
