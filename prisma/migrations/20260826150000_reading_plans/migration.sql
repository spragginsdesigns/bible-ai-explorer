-- Reading plans. A user follows one plan at a time; progress is derived from
-- their existing "ReadingEvent" rows rather than stored, so nothing here
-- records what has been read. "ReadingPlanCompletion" is only the by-hand
-- escape hatch for reading done outside the app.

-- CreateTable
CREATE TABLE "ReadingPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "presetKey" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "days" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadingPlanCompletion" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadingPlanCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadingPlan_userId_status_idx" ON "ReadingPlan"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingPlanCompletion_planId_day_key" ON "ReadingPlanCompletion"("planId", "day");

-- AddForeignKey
ALTER TABLE "ReadingPlan" ADD CONSTRAINT "ReadingPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingPlanCompletion" ADD CONSTRAINT "ReadingPlanCompletion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ReadingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
