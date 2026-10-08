-- The bundled KJV is now the standard 1769 text, which hyphenates many names
-- ("Beth-el", "Beer-sheba", "Tubal-cain") that the old corpus ran together.
-- The 'simple' parser indexes "Beth-el" as beth-el, beth and el, so a search
-- for "Bethel" stopped matching. Index the text with a hyphen between two
-- letters or digits removed; src/lib/bible/verse-fulltext.ts folds queries
-- the same way, so "Bethel" and "Beth-el" both find Genesis 12:8.
--
-- A generated column's expression cannot be changed in place on every
-- Postgres version, so the column (and with it the GIN index) is recreated.
-- As in 20260907190000_kjv_verse_fulltext, neither is representable in
-- schema.prisma; never let a future `migrate dev` drop them.

ALTER TABLE "KjvVerse" DROP COLUMN "search";

ALTER TABLE "KjvVerse" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', regexp_replace("text", '([[:alnum:]])-(?=[[:alnum:]])', '\1', 'g'))
) STORED;

CREATE INDEX "KjvVerse_search_idx" ON "KjvVerse" USING GIN ("search");
