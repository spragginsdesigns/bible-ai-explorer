CREATE TABLE "ChatNotificationStop" (
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "attemptId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatNotificationStop_pkey" PRIMARY KEY ("userId", "conversationId", "attemptId")
);

CREATE INDEX "ChatNotificationStop_expiresAt_idx" ON "ChatNotificationStop"("expiresAt");

ALTER TABLE "ChatNotificationStop" ADD CONSTRAINT "ChatNotificationStop_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatNotificationStop" ADD CONSTRAINT "ChatNotificationStop_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
