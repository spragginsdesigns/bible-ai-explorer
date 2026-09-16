-- Answer feedback (docs/FEATURES.md, "Answer feedback, and how it reaches the
-- doctrinal eval harness"): the user's own thumb on an assistant message, in
-- its own columns rather than metadata so a retry cannot erase it.

ALTER TABLE "Message"
    ADD COLUMN "feedback" TEXT,
    ADD COLUMN "feedbackReason" TEXT,
    ADD COLUMN "feedbackAt" TIMESTAMP(3);

CREATE INDEX "Message_feedback_feedbackAt_idx" ON "Message"("feedback", "feedbackAt");
