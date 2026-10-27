# Knowledge Vault (`vault`, Library)

**LC-17645.** One searchable, private library of everything a founder has
studied in SureWord, at `/beta/library/vault`. Inspired by Notion, Evernote and
Readwise. It also carries the study-platform proposal's P0 "context-aware study
memory" and big idea E, "biblical understanding over time". Built on the
contract in [`README.md`](README.md); founders only, web only.

## What it does

- **Library.** Everything studied, newest first, a page at a time: notes (with
  their wikilinks and backlinks), highlights, chats, reading, verses being
  learned by heart (Learn a verse), memories, the sermon studies of the
  founder's church, and every beta module's items (`BetaItem`). Each card opens
  the thing where it lives in SureWord.
- **Search** by words and by meaning, narrowed by kind, period (any time, past
  month, six months, year, or chosen dates), passage and topic. A search that
  is itself a reference ("John 3", "Romans 8:28", "Psalms") is a passage
  search: everything on that book, chapter or verse.
- **Ask your study history.** "What have I studied about the Holy Spirit over
  the last six months?" is answered only from the founder's own vault, every
  point citing the sources it came from by number, with those sources listed
  below and one tap from where they live. The period a question names ("the
  last six months", "this year", "since March", "in 2025") limits the sources.
  A question nothing in the vault touches costs no model call. Nothing asked is
  stored.
- **Over time.** For one passage or topic, everything studied on it, oldest
  first and grouped by month, with any two entries side by side (by default the
  earliest and latest of the founder's notes, else of anything in their own
  words). Chats are read a question and its answer at a time, dated by the
  question. It quotes and dates; it never scores or says which reading is
  better.
- **Pick up where you left off.** The newest study across the reader, chats,
  notes, Learn a verse and every beta module (Study Projects, Learning Paths and
  the rest), with the latest of each of the others beside it. The reader target
  is the same `lastRead` Today continues from.
- **Export** the whole vault as Markdown or JSON.

## Read in place, never copied

Every source is read from the table SureWord already keeps, scoped to its
owner, into one `VaultEntry` shape (`src/lib/beta/vault/vault-rules.ts`):

| Kind | Source | Date shown | Opens |
|---|---|---|---|
| note | `Note`, `NoteTag`/`Tag`, `NoteLink` | last edited (first written kept) | `/notes?note=` |
| highlight | `VerseHighlight` + the bundled verse text; a colour's name ("Promises") is its topic | marked | the reader at the verse |
| chat | `Conversation`, `Message` | the matching message (library: last message) | `/c/<id>` |
| reading | `ReadingLogEntry`, one entry per day read | that day | the chapter, or `/bible/history` |
| verse | `VerseMemory` + the bundled verse text | last practised | `/bible/learn` |
| memory | `UserMemory` | last changed | `/settings#memory` |
| sermon | `SermonStudy` for the founder's church (`channelIdFor`) | the service date | `/sermons/<id>` |
| study | `BetaItem` through `src/lib/beta/store.ts` (`searchBetaItems`) | last changed | the module's page with `?item=<id>` |

Beta items are read only through the store, which gained two owner-scoped
reads for this module: `searchBetaItems` (words, topic, passage, dates, ids) and
`betaItemVersions`. A module that can open one item reads `?item=<id>`.

**Passages.** Items carry `refs`; highlights, reading and Learn cards carry
coordinates. Notes, chats (their text and the verses their answers retrieved),
memories and sermons are scanned for references (`scanPassageKeys`): a verse
brings its chapter key, a range brings each verse, a chapter-only mention must
be capitalised. A verse search matches the verse, or a mention of its whole
chapter that names no verse in it. SQL narrows prose with a regex on the book
and chapter first; the scan decides.

## Search

- **Words:** Postgres full-text (English stemming) per source, `websearch_to_tsquery`
  for the search box and an OR of a question's subject words for Ask.
- **Meaning:** pgvector, as SureWord already finds notes and verses.
  Notes use `NoteEmbedding` (kept by every note write). Highlights and Learn
  cards use `VerseEmbedding` restricted to the founder's own verses, so "the
  Comforter" finds a highlighted John 14:26. Chats, memories, sermon studies and
  beta items have no vectors anywhere, so the Vault keeps its own
  **`VaultEmbedding`** (below). Hits below 0.3 cosine similarity are dropped.
- The lists are fused by reciprocal rank, so something found by both words and
  meaning rises. Cards say "Found by meaning" when the words were not there.
- A passage chip on a card shows its verses ("Romans 8:28-30, 32") and searches
  the one verse it names, else its chapter.

## Data: `VaultEmbedding`

Migration `20261027020000_beta_vault_index`, one table, vectors only:
`(userId, kind, sourceId, chunk)` with a `sourceHash` fingerprint, a
`halfvec(3072)` from `text-embedding-3-large` (the same model and space as
`NoteEmbedding`), cascading from `User` (in `ACCOUNT_DATA_MODELS` and the
FEATURES.md account deletion table). No text is stored: a hit's words are
re-read from its source. A chat is indexed by its questions whole and the
opening of each answer.

It is brought up to date only when the founder searches or asks
(`refreshVaultIndex`, one bounded step of up to 40 sources and 160 chunks per
request). The page continues the remaining steps while it is open, only after a
search reported sources pending, and stops when a step indexes nothing. A
changed source is re-indexed and a deleted one loses its vectors on the next
step. Indexing sends the founder's words to the embedding model, and a meaning
search sends what they typed, so both run only for an account that has agreed to
AI; words search works either way.

## AI, Scripture and spend

- Ask runs on the house model through `resolveModel` (low effort, structured
  output), metered by `withIncludedAiRequest` as `beta-vault-ask`, and only for
  an account that has agreed to AI (the client asks through the one-time consent
  sheet; the route refuses with `AI_CONSENT_REQUIRED` otherwise).
- The prompt carries SureWord's doctrinal foundation and says: answer only from
  the numbered sources; quote Scripture only where its words appear in a source
  (highlight and Learn sources carry the bundled verse text); SureWord's chat
  answers are SureWord's teaching, never Scripture. The server keeps only points
  that cite real sources (`checkAnswerPoints`), and drops source numbers written
  into the prose.
- Embeddings cost a fraction of a cent per search; an Ask is one low-effort
  call. Nothing runs without the founder asking: no backfill, no job.

## API (`src/app/api/beta/vault/**`)

Every route starts with `requireBetaApi()`; anyone off `BETA_USER_IDS` gets the
ordinary 404, signed out the middleware's 401. Responses are `private, no-store`
and `noindex`.

| Route | What |
|---|---|
| `GET /api/beta/vault` | library or search: `q`, `kind` (comma list), `from`, `to` (YYYY-MM-DD), `passage`, `topic`, `before` (next page), `limit` |
| `GET /api/beta/vault/facets` | counts per kind and the topic labels in use |
| `POST /api/beta/vault/meaning` | one more step of the meaning index |
| `POST /api/beta/vault/ask` | `{ question }` answered from the vault |
| `GET /api/beta/vault/timeline` | `subject` (a passage or a topic) over time |
| `GET /api/beta/vault/resume` | where the founder left off |
| `GET /api/beta/vault/export` | `format=md` or `json` download |

## Files

`src/app/beta/library/vault/page.tsx`, `src/components/beta/vault/`,
`src/lib/beta/vault/` (`vault-rules.ts` is the pure half, tested by
`tests/beta-vault.test.mjs`), `src/app/api/beta/vault/`, the store reads at the
end of `src/lib/beta/store.ts`, and the `VaultEmbedding` block at the end of
`prisma/schema.prisma`.

## For the Living Study Graph

`searchVault`, `vaultTimeline`, the `VaultEntry` shape and the meaning index are
the Graph's starting point: `meaningSearch` already ranks every kind of study
by similarity to any text.

## Proof (LC-17645)

A production build against a Neon branch, signed in as the founder stand-in
(on `BETA_USER_IDS`) and a control account off it, at 1280 and 375px with
touch. The stand-in's notes, highlights, reading, Learn cards, memories and four
chats were written through SureWord's own routes (the chats answered by the real
model), then dated across March to October; beta items were written in the
store's shape, and the stand-in joined a church with sermon studies. The control
holds marker-stamped study on the same passages and topics (plus a meaning
vector copied from the founder's), and none of it ever reached the founder's
library, search, passage, topic, timeline, Ask or export. Every vault page is
the control's ordinary 404 and every vault route a 404. The issue's closeout
lists the checks.
