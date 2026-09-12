-- What the user calls each highlight colour ("yellow" -> "Promises"). Nullable
-- with no default: an account that has never named a colour reads as the hue.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "highlightLabels" JSONB;
