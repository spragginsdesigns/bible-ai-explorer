-- "Walk with me", the guided first run (docs/onboarding/PLAN.md).
ALTER TABLE "User" ADD COLUMN "onboardingConversationId" TEXT;
ALTER TABLE "User" ADD COLUMN "textScale" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "User" ADD COLUMN "voiceMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "onboardingVoiceChars" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "firstInsightAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "firstCrossOpenedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "gettingStartedDismissedAt" TIMESTAMP(3);
