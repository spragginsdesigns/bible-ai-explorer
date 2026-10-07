-- "My testimony": how the user came to faith, in their own words. Private and
-- read by the assistant only. Nullable with no default: an account that has not
-- written one reads exactly as before.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "testimony" TEXT;
