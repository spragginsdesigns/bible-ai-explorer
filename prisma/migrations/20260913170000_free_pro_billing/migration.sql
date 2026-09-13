ALTER TABLE "User" ADD COLUMN "includedAiPreferred" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "BillingSubscription" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "stripeCustomerId" TEXT NOT NULL UNIQUE,
  "stripeSubscriptionId" TEXT UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'incomplete',
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "BillingEvent" (
  "id" TEXT PRIMARY KEY,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AiUsageRequest" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "idempotencyKey" TEXT NOT NULL,
  "surface" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'reserved',
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "cacheTokens" INTEGER NOT NULL DEFAULT 0,
  "costMicros" INTEGER NOT NULL DEFAULT 0,
  "calls" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AiUsageRequest_userId_idempotencyKey_key" ON "AiUsageRequest"("userId", "idempotencyKey");
CREATE INDEX "AiUsageRequest_userId_createdAt_status_idx" ON "AiUsageRequest"("userId", "createdAt", "status");
