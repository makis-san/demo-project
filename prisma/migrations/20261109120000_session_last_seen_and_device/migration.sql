-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "deviceLabel" TEXT NOT NULL DEFAULT 'Unknown device',
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
