-- Movements used to be one shared list. Each user now owns their own.
--
-- Existing movements have no known owner, so each user gets their own copy of
-- every movement name they logged a set with, and their sets are moved onto
-- that copy. Two shared movements with the same name used by the same user
-- are merged into one. Movements that no set uses are deleted, because there
-- is no way to tell whose they were.

-- 1. Add the owner column, empty for now
ALTER TABLE "Movement" ADD COLUMN "userId" TEXT;

-- 2. One copy per user and movement name that has at least one set
INSERT INTO "Movement" ("id", "name", "userId")
SELECT gen_random_uuid()::text, m."name", w."userId"
FROM "Set" s
JOIN "Workout" w ON w."id" = s."workoutId"
JOIN "Movement" m ON m."id" = s."movementId"
WHERE m."userId" IS NULL
GROUP BY w."userId", m."name";

-- 3. Point each set at its owner's copy
UPDATE "Set" s
SET "movementId" = n."id"
FROM "Workout" w, "Movement" m, "Movement" n
WHERE w."id" = s."workoutId"
  AND m."id" = s."movementId"
  AND m."userId" IS NULL
  AND n."userId" = w."userId"
  AND n."name" = m."name";

-- 4. Remove the old shared rows, including unused ones
DELETE FROM "Movement" WHERE "userId" IS NULL;

-- 5. Make the owner required and add the constraints
ALTER TABLE "Movement" ALTER COLUMN "userId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Movement_userId_name_key" ON "Movement"("userId", "name");

-- AddForeignKey
ALTER TABLE "Movement" ADD CONSTRAINT "Movement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
