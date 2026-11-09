-- Workout presets: a workout planned ahead and kept in the user's library, with the weekdays it is the workout of the day,
-- and the link from a started workout back to its preset.
--
-- The tables come from Prisma's diff. The statements after it are what Prisma cannot express.


-- AlterTable
ALTER TABLE "Workout" ADD COLUMN     "presetId" TEXT;

-- CreateTable
CREATE TABLE "WorkoutPreset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresetExercise" (
    "id" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "restSeconds" INTEGER NOT NULL DEFAULT 60,

    CONSTRAINT "PresetExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresetSet" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "weight" DECIMAL(6,2),

    CONSTRAINT "PresetSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresetDay" (
    "presetId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,

    CONSTRAINT "PresetDay_pkey" PRIMARY KEY ("presetId","weekday")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutPreset_userId_name_key" ON "WorkoutPreset"("userId", "name");

-- CreateIndex
CREATE INDEX "PresetExercise_presetId_position_idx" ON "PresetExercise"("presetId", "position");

-- CreateIndex
CREATE INDEX "PresetExercise_movementId_idx" ON "PresetExercise"("movementId");

-- CreateIndex
CREATE INDEX "PresetSet_exerciseId_position_idx" ON "PresetSet"("exerciseId", "position");

-- CreateIndex
CREATE INDEX "PresetDay_weekday_idx" ON "PresetDay"("weekday");

-- CreateIndex
CREATE INDEX "Workout_presetId_idx" ON "Workout"("presetId");

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "WorkoutPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPreset" ADD CONSTRAINT "WorkoutPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresetExercise" ADD CONSTRAINT "PresetExercise_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "WorkoutPreset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresetExercise" ADD CONSTRAINT "PresetExercise_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "Movement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresetSet" ADD CONSTRAINT "PresetSet_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "PresetExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresetDay" ADD CONSTRAINT "PresetDay_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "WorkoutPreset"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Weekdays are ISO: 1 Monday to 7 Sunday.
ALTER TABLE "PresetDay" ADD CONSTRAINT "PresetDay_weekday_range" CHECK ("weekday" BETWEEN 1 AND 7);
-- Rest and reps stay in a sane range even for a request that skips the app's validation.
ALTER TABLE "PresetExercise" ADD CONSTRAINT "PresetExercise_rest_range" CHECK ("restSeconds" BETWEEN 0 AND 3600);
ALTER TABLE "PresetSet" ADD CONSTRAINT "PresetSet_reps_range" CHECK ("reps" BETWEEN 1 AND 1000);
