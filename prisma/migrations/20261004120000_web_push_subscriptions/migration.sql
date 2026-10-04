-- Web Push subscriptions for browser notifications (platform "web"). The
-- endpoint URL rides in the existing unique "token" column; these hold the
-- subscription's encryption keys. Additive and nullable: Expo rows are untouched.

-- AlterTable
ALTER TABLE "PushToken" ADD COLUMN     "webAuth" TEXT,
ADD COLUMN     "webP256dh" TEXT;
