-- SureWord Beta, Study Rooms (LC-17647, docs/beta/rooms.md): rooms, their
-- members and what they share. Three new tables; the only locks on existing
-- tables are the brief ones the "User" foreign keys take.
--
-- Written by hand from `prisma migrate diff` between the previous schema and
-- this one, so it holds only the BetaRoom* statements and none of the drops
-- of the hand-made pgvector and full-text indexes that a diff against the
-- database proposes.

-- The User foreign keys briefly block writes to "User" while they are added.
-- Give up after 5 s rather than queue every sign-in behind a long transaction.
SET lock_timeout = '5s';

CREATE TABLE "BetaRoom" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'study',
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "inviteToken" TEXT,
    "planPresetKey" TEXT,
    "planStartDate" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BetaRoom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BetaRoomMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "displayName" VARCHAR(40) NOT NULL,
    "planId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaRoomMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BetaRoomPost" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "module" TEXT NOT NULL DEFAULT 'rooms',
    "kind" TEXT NOT NULL,
    "parentId" TEXT,
    "title" VARCHAR(120),
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaRoomPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BetaRoom_inviteToken_key" ON "BetaRoom"("inviteToken");

CREATE INDEX "BetaRoom_ownerId_idx" ON "BetaRoom"("ownerId");

CREATE INDEX "BetaRoomMember_userId_idx" ON "BetaRoomMember"("userId");

CREATE UNIQUE INDEX "BetaRoomMember_roomId_userId_key" ON "BetaRoomMember"("roomId", "userId");

CREATE INDEX "BetaRoomPost_roomId_createdAt_idx" ON "BetaRoomPost"("roomId", "createdAt");

CREATE INDEX "BetaRoomPost_authorId_idx" ON "BetaRoomPost"("authorId");

CREATE INDEX "BetaRoomPost_parentId_idx" ON "BetaRoomPost"("parentId");

ALTER TABLE "BetaRoom" ADD CONSTRAINT "BetaRoom_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BetaRoomMember" ADD CONSTRAINT "BetaRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "BetaRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BetaRoomMember" ADD CONSTRAINT "BetaRoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BetaRoomPost" ADD CONSTRAINT "BetaRoomPost_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "BetaRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BetaRoomPost" ADD CONSTRAINT "BetaRoomPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BetaRoomPost" ADD CONSTRAINT "BetaRoomPost_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "BetaRoomPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

