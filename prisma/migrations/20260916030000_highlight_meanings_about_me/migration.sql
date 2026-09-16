-- Why the user reaches for each highlight colour ("blue" -> "something God said
-- He will do"), one sentence per colour, and "About me" in their own words. Both
-- nullable with no default: an account that has written neither reads as before.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "highlightMeanings" JSONB,
ADD COLUMN "aboutMe" TEXT;
