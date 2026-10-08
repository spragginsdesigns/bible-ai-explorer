-- Getting to know you (docs/FEATURES.md, "Getting to know you"): when the
-- in-chat onboarding interview finished or was skipped. Null means SureWord
-- still runs the interview in this person's chats.
--
-- Everyone who has already had an answer is backfilled as onboarded, so the
-- interview never ambushes an existing member; they can still start it with
-- /onboard. Accounts that signed up but never got an answer stay null and get
-- the interview on their first chat.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "onboardedAt" TIMESTAMP(3);

-- Backfill
UPDATE "User" u SET "onboardedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM "Message" m
  JOIN "Conversation" c ON c."id" = m."conversationId"
  WHERE c."userId" = u."id" AND m."role" = 'assistant'
);
