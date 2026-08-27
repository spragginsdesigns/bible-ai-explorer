-- My church (Settings): one Google Places-backed church profile per user,
-- injected into the chat prompt beside memories.
CREATE TABLE "UserChurch" (
    "userId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "mapsUrl" TEXT,
    "photoUrl" TEXT,
    "photoSource" TEXT,
    "photoName" TEXT,
    "mission" TEXT,
    "about" TEXT,
    "missionSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserChurch_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserChurch" ADD CONSTRAINT "UserChurch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
