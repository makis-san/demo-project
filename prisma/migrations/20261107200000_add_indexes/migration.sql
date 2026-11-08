-- CreateIndex
CREATE INDEX "Set_workoutId_idx" ON "Set"("workoutId");

-- CreateIndex
CREATE INDEX "Set_movementId_idx" ON "Set"("movementId");

-- CreateIndex
CREATE INDEX "Workout_userId_completedAt_idx" ON "Workout"("userId", "completedAt");

