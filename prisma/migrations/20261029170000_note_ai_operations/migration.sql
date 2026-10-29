CREATE TABLE "NoteAIOperation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "requestHash" TEXT,
    "state" TEXT NOT NULL DEFAULT 'reserved',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NoteAIOperation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NoteAIOperation_state_check" CHECK ("state" IN ('reserved', 'running', 'settled', 'cancelled'))
);

CREATE INDEX "NoteAIOperation_userId_noteId_createdAt_idx" ON "NoteAIOperation"("userId", "noteId", "createdAt");
ALTER TABLE "NoteAIOperation" ADD CONSTRAINT "NoteAIOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteAIOperation" ADD CONSTRAINT "NoteAIOperation_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
