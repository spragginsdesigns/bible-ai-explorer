-- Ways to Serve: the reader's choice, "I already give to my church", and the private journal.
-- Give up after 5 s rather than queue every sign-in behind a long transaction.
SET lock_timeout = '5s';

ALTER TABLE "User" ADD COLUMN "serveMode" TEXT;
ALTER TABLE "User" ADD COLUMN "givesToChurch" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ServiceEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "verseRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceEntry_userId_createdAt_idx" ON "ServiceEntry"("userId", "createdAt");

ALTER TABLE "ServiceEntry" ADD CONSTRAINT "ServiceEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
