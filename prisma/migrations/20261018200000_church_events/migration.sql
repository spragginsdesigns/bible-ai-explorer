-- Gatherings announced from the pulpit, lifted out of a recorded service (see
-- the ChurchEvent model comment in prisma/schema.prisma). Scoped by channel
-- like the SermonStudy they came from, and deleted with it.

-- CreateTable
CREATE TABLE "ChurchEvent" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "audience" TEXT,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timeZone" TEXT NOT NULL,
    "certain" BOOLEAN NOT NULL,
    "unsureWhy" TEXT,
    "sourceQuote" TEXT NOT NULL,
    "sourceMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChurchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChurchEvent_channelId_startsAt_idx" ON "ChurchEvent"("channelId", "startsAt");

-- CreateIndex
CREATE INDEX "ChurchEvent_studyId_idx" ON "ChurchEvent"("studyId");

-- AddForeignKey
ALTER TABLE "ChurchEvent" ADD CONSTRAINT "ChurchEvent_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "SermonStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
