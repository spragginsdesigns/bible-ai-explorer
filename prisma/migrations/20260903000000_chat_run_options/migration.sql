-- The chat picker's run options, stored beside "defaultModelId" and
-- "defaultEffort": speed ("standard" | "fast"), verbosity ("low" | "medium" |
-- "high") and reasoning mode ("standard" | "pro"). Nullable and unconstrained
-- on purpose, matching the two columns they sit with: every value is validated
-- on read against src/lib/ai/models.ts and then clamped to what the chosen
-- model accepts, so a stale value degrades to the provider default instead of
-- erroring.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "defaultSpeed" TEXT;
ALTER TABLE "User" ADD COLUMN     "defaultVerbosity" TEXT;
ALTER TABLE "User" ADD COLUMN     "defaultMode" TEXT;
