-- CreateTable
CREATE TABLE "LegacyClerkAccount" (
    "email" TEXT NOT NULL,
    "legacyUserId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyClerkAccount_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegacyClerkAccount_legacyUserId_key" ON "LegacyClerkAccount"("legacyUserId");
