-- Built-in movements and the muscles each one trains, and workouts that can be started from a previous one.
--
-- A movement is built in when "userId" is null. Its rows are not written here: they come from the catalog in
-- src/lib/movement-catalog.ts, through the seed (scripts/seed-movements.ts), which runs after the migrations on
-- every start. Product data that changes with releases does not belong in a migration. The seed also merges a
-- custom movement that has the name of a built-in into it, so a user's history continues under one movement.
--
-- The tables are created by Prisma's diff. The statements after it are what Prisma cannot express.


-- CreateEnum
CREATE TYPE "MuscleGroup" AS ENUM ('chest', 'shoulders', 'traps', 'lats', 'lower_back', 'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'glutes', 'quads', 'hamstrings', 'calves');

-- CreateEnum
CREATE TYPE "Equipment" AS ENUM ('barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'other');

-- AlterTable
ALTER TABLE "Movement" ADD COLUMN     "equipment" "Equipment",
ADD COLUMN     "primaryMuscles" "MuscleGroup"[] DEFAULT ARRAY[]::"MuscleGroup"[],
ADD COLUMN     "secondaryMuscles" "MuscleGroup"[] DEFAULT ARRAY[]::"MuscleGroup"[],
ADD COLUMN     "slug" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Workout" ADD COLUMN     "sourceWorkoutId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Movement_slug_key" ON "Movement"("slug");

-- CreateIndex
CREATE INDEX "Workout_sourceWorkoutId_idx" ON "Workout"("sourceWorkoutId");

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_sourceWorkoutId_fkey" FOREIGN KEY ("sourceWorkoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Postgres treats nulls as distinct, so UNIQUE ("userId", "name") does not stop two built-ins with one name.
-- This does, and ignoring case also means the library never lists two "Bench Press".
CREATE UNIQUE INDEX "Movement_builtin_name_key" ON "Movement" (lower("name")) WHERE "userId" IS NULL;

-- A movement is exactly one of: a user's own (owner, no slug) or built in (no owner, slug). A user's movement can
-- never become a built-in by losing its owner, and a built-in always has the key the seed upserts on.
ALTER TABLE "Movement" ADD CONSTRAINT "Movement_owner_or_slug" CHECK (("userId" IS NULL) = ("slug" IS NOT NULL));
