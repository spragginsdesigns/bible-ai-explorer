-- SureWord Pro through StoreKit 2 (iOS). One row per App Store subscription
-- (originalTransactionId), cascading with the user like the Stripe and Google
-- Play rows. Additive only: no existing table changes.

-- CreateTable
CREATE TABLE "AppStoreSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalTransactionId" TEXT NOT NULL,
    "latestTransactionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "gracePeriodExpiresAt" TIMESTAMP(3),
    "environment" TEXT NOT NULL,
    "appAccountToken" TEXT,
    "lastSignedAt" TIMESTAMP(3) NOT NULL,
    "lastNotificationType" TEXT,
    "lastNotificationSubtype" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppStoreSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppStoreSubscription_originalTransactionId_key" ON "AppStoreSubscription"("originalTransactionId");

-- CreateIndex
CREATE INDEX "AppStoreSubscription_userId_idx" ON "AppStoreSubscription"("userId");

-- AddForeignKey
ALTER TABLE "AppStoreSubscription" ADD CONSTRAINT "AppStoreSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
