# SureWord Beta (founders only, web)

**The ask (Jay, LC-17631, 2026-10-26).** "Split off a beta version of SureWord
for founders only (Jay and Austin), just for webview for now", then "fan out
agents and build all of these things into it ... each one like a full fledged
project ... we want SureWord to become the premiere app for Bible study." The
list is the study-platform proposal in that issue: knowledge graph, learning
paths, Scripture memory, study projects, atlas and timeline, audio overviews,
knowledge vault, voice study, concept maps, habits, study rooms, a Socratic
tutor, and the bigger ideas (living study graph, Scripture verification,
personal curriculum, sermon to study, understanding over time). The founders'
concept board (Home, Bible Reader, AI Study Assistant, Study Projects, Learning
Paths, Scripture Memory, Maps & Timeline, Audio Companion, Knowledge Graph,
Personal Growth) is the visual direction.

This folder is the contract every module run follows. Each module also gets
its own `docs/beta/<slug>.md` written by the run that builds it.

**The six SureWord products (Jay, LC-17639).** Family, Kids, Groups, Churches,
Pastor and Academy are built into the same beta as experiences of one app, not
separate apps, on the modules below. Their brainstorm, privacy model and build
order are in [expansion.md](expansion.md), which their runs read before this
file.

## Who can open it

- **`BETA_USER_IDS`**: comma-separated Clerk ids, the same parser as
  `ADMIN_USER_IDS` and `PRO_USER_IDS` (`src/lib/entitlements-rules.ts`). Set in
  all three Vercel scopes to Austin's and Jay's production accounts. Unset or
  empty means nobody. Adding a tester is appending an id; no deploy needed
  beyond Vercel's env refresh on the next deployment.
- **Everyone else** gets exactly what a missing path gives them: signed out,
  the middleware's redirect to `/sign-in` (pages) or `401` (API); signed in and
  not on the list, the ordinary `404`, with the root title and nothing about the
  beta in the HTML. Not 403: a beta page looks like any page that does not
  exist. That keeps the beta out of sight, not secret (the switch's code ships
  in the app bundle like any other); the gate is what protects it.
- **The toggle** (LC-17639) is one two-way switch, **SureWord | Beta**
  (`src/components/beta/BetaVersionSwitch.tsx`). In regular SureWord it sits
  under "Version" at the bottom of the settings menu (`AppOptions`) on Today,
  Bible, Study, Connections and Notes; inside the beta it sits at the foot of
  the desktop rail and in the phone header. The version you are in is marked
  and is not a link. The menu asks `GET /api/beta/access` (`{ beta: boolean }`,
  the one beta route open to every account) only when it is first opened, once
  per account per session, and shows the switch only to founders.
- **Web only.** Android, macOS and iOS are out of scope until the founders say
  otherwise; `docs/PARITY.md` records that. Never touch `mobile/` or `macos/`
  for a beta module.

## The map

Six destinations: **Home** (`/beta`), **Bible**, **Study**, **Library** and
**Learn** from the concept board, and **Together** (family, groups and church,
LC-17639) (`/beta/<destination>`). Every module
lives at `/beta/<destination>/<slug>`. `src/lib/beta/modules.ts` is the single
source of truth: the shell's tabs, the destination pages, Home's "In the
workshop" list and each module's placeholder page all read it.

| Destination | Module (slug) | Priority |
|---|---|---|
| Bible | Atlas & Timeline (`atlas`) | P3 |
| Study | Study Projects (`projects`) | P0 |
| Study | Scripture Check (`verify`) | P0 |
| Study | Socratic Tutor (`tutor`) | P1 |
| Study | Sermon to Study (`sermons`) | P2 |
| Study | Voice Study (`voice`) | P2 |
| Study | Audio Overviews (`audio`) | P2 |
| Study | Concept Maps (`maps`) | P2 |
| Study | Study Rooms (`rooms`) | P3 |
| Library | Knowledge Vault (`vault`), with study memory and understanding over time | P0 |
| Library | Living Study Graph (`graph`) | P2 |
| Learn | Learning Paths (`paths`), with the personal theology curriculum | P1 |
| Learn | Scripture Memory (`memory`) | P1 |
| Learn | Habits & Reflection (`growth`) | P2 |
| Together | SureWord Family (`family`) | P1 |
| Together | SureWord Groups (`groups`) | P1 |
| Together | SureWord Kids (`kids`) | P2 |
| Together | SureWord Churches (`churches`) | P3 |
| Study | SureWord Pastor (`pastor`) | P2 |
| Learn | SureWord Academy (`academy`) | P2 |

Each entry's `issue` field names the Linear issue building it.

## Building a module

A module run owns only its own files, so many can be built at once without
touching each other:

| What | Where |
|---|---|
| Pages | `src/app/beta/<destination>/<slug>/page.tsx` and anything under it. A static route outranks the `[slug]` placeholder beside it, so adding the folder is what replaces the placeholder. |
| Components | `src/components/beta/<slug>/` |
| Logic | `src/lib/beta/<slug>/`, with pure rules in a `*-rules.ts` that has no imports (tests load it with Node's type stripping) |
| API | `src/app/api/beta/<slug>/**/route.ts` |
| Tests | `tests/beta-<slug>*.test.mjs` |
| Docs | `docs/beta/<slug>.md` (what it does, its data, its proof) |
| Registry | its own entry in `src/lib/beta/modules.ts`: set `issue`, flip `status` to `building` when the first usable slice ships and `live` when the module is complete (`live` requires the static route; a test checks), and keep `summary` and `capabilities` true to what shipped. Touch no other entry. |

**Every page** calls `await requireBetaPage()` itself, and any metadata goes
through `betaMetadata()` in `generateMetadata` (never a static `metadata`
export: Next resolves metadata even when the layout calls `notFound()`, and a
static title would label everyone else's 404). **Every API route** starts with
`const gate = await requireBetaApi(); if (!gate.ok) return gate.response;` and
works only on `gate.userId`'s data. `tests/beta-access.test.mjs` fails the
build of any page or route that skips these.

**Do not edit** the shell (`BetaShell.tsx`), Home (`BetaHome.tsx`), the
placeholder and destination components, `MobileBottomNav`, or another module's
files. Home's workshop list and the destination pages pick up your status from
the registry. A module that genuinely needs a place on Home says so in its
issue and the founders decide.

## The shared study store

Most modules need no table of their own. `BetaItem` keeps every module's
objects (a project, a source, a path enrollment, a habit, a verification
report) and `BetaLink` the connections between them, so the Knowledge Vault
can search and the Living Study Graph can connect every module's work through
one shape. Use it through `src/lib/beta/store.ts` only, never
`prisma.betaItem` directly; every call is scoped to its owner and a foreign id
behaves like a missing one.

- `module` is your registry slug; `kind` is yours to define (`project`,
  `source`, `session`), lowercase with dashes.
- `title` (up to 200 characters) and `body` (plain text a person reads and
  searches, up to 200,000) are what the Vault indexes; `data` is your own
  structured fields (a plain JSON object up to 256 KB) that your code
  validates.
- `refs` are passage keys, `"<book>.<chapter>"` or `"<book>.<chapter>.<verse>"`
  with the book's canonical order (John 3:16 is `43.3.16`). Build them with
  `betaRefKey` from what `resolveReference` (`src/lib/bible/books.ts`) returns.
  Every verse key brings its chapter key, so `listBetaItems(userId, { ref: "43.3" })`
  finds everything on John 3.
- `topics` are short lowercase labels ("justification").
- `parentId` nests items (sources in a project); deleting a parent deletes its
  children and every link touching them. Account deletion cascades.

**Private items.** An item whose `data` has `private: true` (the Habits &
Reflection journal and its "put into practice" items, `docs/beta/growth.md`)
keeps its words in `data` only, under a fixed `title` and no `body`. Another
module may count, list or link it by its `title`, `refs` and dates, but never
reads, indexes, shows or sends its `data` to an AI. Check it before passing
any item's `data` anywhere.

**Reuse what SureWord already owns** instead of copying it into the store:
notes are `Note` (with wikilinks, backlinks and embeddings), memory cards are
Learn a verse (`VerseMemory`), plans are `ReadingPlan`, highlights are
`VerseHighlight`, chats are `Conversation`. Store a pointer (`noteId`,
`conversationId`) in your item's `data` when you need one.

**A table of your own** is for what the store cannot do well (vector search,
high-volume rows, real relational queries). Then:

1. Add it at the end of `prisma/schema.prisma` in its own block headed
   `// Beta module: <slug>`, and its `User` back-relation in its own commented
   slot at the end of the `User` model.
2. Add it to `ACCOUNT_DATA_MODELS` (`src/lib/account-deletion.ts`) and the
   Account deletion table in `docs/FEATURES.md`.
3. Write the migration by hand. **Never run `prisma format`**: the schema is
   not format-clean and it rewrites about 120 unrelated lines. **Never keep
   what `prisma migrate diff` proposes for the hand-made indexes**: it offers to
   drop the pgvector and full-text indexes on `VerseEmbedding`, `NoteEmbedding`,
   `KjvVerse` and `OriginalVerse`, which would break Scripture retrieval. Keep
   only your own statements (`prisma/migrations/20261026230000_beta_study_store`
   is the model).
4. Apply it to a Neon branch first, then `prisma migrate deploy` to production
   with the URL pinned, as `CLAUDE.md` describes.

## AI, Scripture and spend

- Every prompt carries SureWord's mission (`CLAUDE.md`, Mission): KJV-rooted,
  Scripture first, no watering down. Interpretation is labelled as
  interpretation and never presented as Scripture. Quoted verses come from the
  bundled text (`src/lib/bible/`), never from the model's memory.
- Use the house model and provider code in `src/lib/ai/` and the retrieval in
  `src/lib/scripture-search.ts`; do not add a provider or a key.
- User-facing AI output is proven with real questions through the real path
  and judged on quality, not just shape (`.claude/commands/prove-it.md`, rule 6).
- Generation happens only when a founder asks for it. No backfills, no
  pre-generation for every chapter, no scheduled jobs without the founders'
  approval in the issue; paid audio (ElevenLabs) and long transcriptions stay
  on explicit request.

## Look and feel

The shell gives every page the header, the desktop rail and the mobile tab
bar. Pages start with `mx-auto w-full max-w-* px-5 pt-* pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] lg:px-8 lg:pb-16`.
Use SureWord's own surfaces (parchment `#f6f2e9` / `#0d100d`, ink `#24281f` /
`#f1eadc`, gold `#e5b664` as the one accent, Cormorant Garamond headings,
`rounded-[22px]` cards with `border-black/[.09] bg-white/35`), the
destination tint only on icon tiles (`DESTINATION_TILE` in
`src/components/beta/visuals.tsx`), and the shared `StatusChip` and
`IconTile`. 375px first, 44px touch targets, light and dark both, no blur or
animated glow on repeating UI. The concept board is direction, not a pixel
spec: real data and SureWord's components decide.

## Proving a module

The real path is a production build of SureWord signed in as a founder:

- Build and run it in a scratch clone (`pnpm build`, then `next start`); the
  build needs a heap above 3 GB.
- Point it at a throwaway Neon branch of the `versemind` project, never at
  production data you write to, and delete the branch when done. A shell on the
  VPS may already export a `DATABASE_URL` for another database: unset it and
  pin the branch URL (`CLAUDE.md`, Database, trap 2).
- Use the development Clerk instance (its keys are Vercel's Development
  scope), put a `+clerk_test` QA account on the local `BETA_USER_IDS`, and sign
  in with a Clerk sign-in token (`/sign-in?__clerk_ticket=<token>`). A second
  QA account off the list is the negative control: every beta page must be the
  ordinary 404 for it, and every `/api/beta` route a 404.
- A fresh account first meets the AI consent sheet and the What's new
  catch-up; answer them as a person would. The launch splash covers the page for
  about two seconds after every full load and a tap only dismisses it.
- Prove at 1280 desktop and 375px with touch, light and dark, with the console
  clean, and attack it (empty input, someone else's ids, unknown slugs).

After shipping: `https://sureword.app/beta` redirects to sign-in when signed
out and `/api/beta/access` answers 401, exactly like any unknown path.
