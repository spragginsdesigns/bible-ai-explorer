-- CreateEnum
CREATE TYPE "ChatAttachmentStatus" AS ENUM ('PENDING', 'READY');

-- CreateTable
CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT,
    "pathname" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "etag" TEXT,
    "status" "ChatAttachmentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatAttachment_pathname_key" ON "ChatAttachment"("pathname");

-- CreateIndex
CREATE INDEX "ChatAttachment_userId_idx" ON "ChatAttachment"("userId");

-- CreateIndex
CREATE INDEX "ChatAttachment_messageId_idx" ON "ChatAttachment"("messageId");

-- CreateIndex
CREATE INDEX "ChatAttachment_status_createdAt_idx" ON "ChatAttachment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
