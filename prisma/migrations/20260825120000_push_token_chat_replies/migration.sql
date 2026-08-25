-- "Your answer is ready" pushes, independent of the verse-of-the-day toggle.
ALTER TABLE "PushToken" ADD COLUMN "chatReplies" BOOLEAN NOT NULL DEFAULT true;
