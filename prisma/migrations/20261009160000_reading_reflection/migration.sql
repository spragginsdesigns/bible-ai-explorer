-- "Your walk" reflection on the reading log (docs/FEATURES.md, "Reading log").
-- One row per account, replaced when the reading behind it changes.

-- CreateTable
CREATE TABLE "ReadingReflection" (
    "userId" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadingReflection_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "ReadingReflection" ADD CONSTRAINT "ReadingReflection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
