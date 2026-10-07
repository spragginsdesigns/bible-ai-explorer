-- Owner review queue (/admin/feedback, ADMIN_USER_IDS only): a reported answer
-- or a Send feedback message is marked reviewed by a person. Both nullable:
-- every existing row reads as unreviewed and nothing else changes.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "feedbackReviewedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN "reviewedAt" TIMESTAMP(3);
