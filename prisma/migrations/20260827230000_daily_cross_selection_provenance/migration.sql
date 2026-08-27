-- Durable selection provenance for Pick Up Your Cross.
-- Existing rows remain null because their theme, evidence and fallback state
-- cannot be reconstructed reliably after the fact.
ALTER TABLE "VerseOfDay"
  ADD COLUMN "primaryTheme" TEXT,
  ADD COLUMN "primaryThemeKey" TEXT,
  ADD COLUMN "themeTags" JSONB,
  ADD COLUMN "selectionMode" TEXT,
  ADD COLUMN "selectionReason" TEXT,
  ADD COLUMN "selectionEvidence" JSONB,
  ADD COLUMN "selectorModel" TEXT,
  ADD COLUMN "selectorEffort" TEXT,
  ADD COLUMN "writerModel" TEXT,
  ADD COLUMN "writerEffort" TEXT,
  ADD COLUMN "isFallback" BOOLEAN,
  ADD COLUMN "fallbackReason" TEXT;
