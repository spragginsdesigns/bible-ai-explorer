-- Full-text index of the bundled KJV: one row per verse, so exact-word and
-- phrase lookups ("be still and know", every verse containing "loveth") are a
-- GIN index scan in Postgres instead of an in-process scan of all 31,102
-- verses in JavaScript, and cost no embedding call.
--
-- The dictionary is 'simple', not 'english', on purpose. Snowball's English
-- stemmer was built for modern prose and does not fold the KJV's archaic
-- inflections (loveth, lovest, believeth, doeth) onto their roots, so
-- 'english' buys almost nothing here while destroying the ability to match a
-- word the user typed exactly. 'simple' lowercases and nothing else, and the
-- query builder adds prefix matching (`'lov':*`) where recall is wanted.
--
-- The generated `search` column and its GIN index are NOT representable in
-- schema.prisma (`search` is Unsupported("tsvector") there, the index has no
-- Prisma form at all); never let a future `migrate dev` drop them.

-- CreateTable
CREATE TABLE "KjvVerse" (
    "book" INTEGER NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "search" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "text")) STORED,

    CONSTRAINT "KjvVerse_pkey" PRIMARY KEY ("book", "chapter", "verse")
);

-- CreateIndex
CREATE INDEX "KjvVerse_search_idx" ON "KjvVerse" USING GIN ("search");
