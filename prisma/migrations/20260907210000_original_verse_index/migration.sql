-- Verse-grain index of the bundled original-language Bible: the Westminster
-- Leningrad Codex for books 1-39 and Scrivener's 1894 Textus Receptus for
-- books 40-66, one row per verse of the ORIGINAL versification.
--
-- Why a table rather than reading src/data/originals/*.json in process: the
-- two useful questions are "every verse containing this Hebrew word" and
-- "every verse using Strong's H2617", and both are whole-Bible scans over
-- 31,170 verses and 446,165 words in JavaScript. As a GIN index scan in
-- Postgres they are a few milliseconds and cost no embedding call, exactly
-- like "KjvVerse" does for the English.
--
-- `text` is the verse as bundled: pointed Hebrew, with vowels and
-- cantillation. `plain` is the same verse folded to bare consonants (Hebrew)
-- or bare lowercase letters (Greek) by scripts/lib/original-text-normalize.mjs,
-- because a reader searching for a word types the consonants and would never
-- match the pointed form.
--
-- The dictionary is 'simple' for the same reason as "KjvVerse", only more so:
-- Postgres ships no Hebrew or Greek dictionary at all, so there is nothing to
-- stem with. 'simple' lowercases and splits on whitespace, and `plain` has
-- already done the folding a dictionary would otherwise do.
--
-- The kjv columns are the alignment to KJV coordinates, and they are NULLABLE
-- on purpose. The WLC numbers Psalm superscriptions as verse 1, so 66 verses
-- have no KJV coordinate at all. They also carry no unique constraint on
-- purpose: four WLC verses are only the second half of a KJV verse that
-- another WLC verse already covers (WLC 1 Kings 22:44 is KJV 22:43b), so the
-- mapping is many-to-one in those places. See
-- scripts/lib/original-versification.mjs for the verified table.
--
-- The generated `search` column and both GIN indexes are NOT representable in
-- schema.prisma (`search` is Unsupported("tsvector") there, the indexes have
-- no Prisma form at all); never let a future `migrate dev` drop them.

-- CreateTable
CREATE TABLE "OriginalVerse" (
    "book" INTEGER NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "plain" TEXT NOT NULL,
    "strongs" TEXT[] NOT NULL,
    "kjvBook" INTEGER,
    "kjvChapter" INTEGER,
    "kjvVerse" INTEGER,
    "search" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "plain")) STORED,

    CONSTRAINT "OriginalVerse_pkey" PRIMARY KEY ("book", "chapter", "verse")
);

-- CreateIndex
CREATE INDEX "OriginalVerse_strongs_idx" ON "OriginalVerse" USING GIN ("strongs");

-- CreateIndex
CREATE INDEX "OriginalVerse_search_idx" ON "OriginalVerse" USING GIN ("search");

-- CreateIndex
CREATE INDEX "OriginalVerse_kjv_idx" ON "OriginalVerse" ("kjvBook", "kjvChapter", "kjvVerse");
