-- CreateTable
CREATE TABLE "SuggestedQuestionSet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questions" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestedQuestionSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SuggestedQuestionSet_userId_createdAt_idx" ON "SuggestedQuestionSet"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "SuggestedQuestionSet" ADD CONSTRAINT "SuggestedQuestionSet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
