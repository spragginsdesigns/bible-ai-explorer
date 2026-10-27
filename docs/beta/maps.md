# Concept Maps (`maps`, Study)

**Issue:** LC-17654 (Jay, LC-17631: "build each feature like a full fledged
project"). **Route:** `/beta/study/maps`. **Status:** live, founders only, web
only. Inspired by Miro and mind-mapping software: the founder explores a
doctrine visually instead of only reading a long answer, and every idea opens
the verses behind it.

## What it does

- **Seven ready-made maps**, written once, reviewed for doctrinal care and
  committed as data (`src/lib/beta/maps/library-data.ts`): the Trinity; the
  covenants (Noahic, Abrahamic, Mosaic, Davidic, new); salvation (our need,
  God's provision, repentance and faith, justification, sanctification,
  glorification); the order of the Gospels' events (seven stages, each event
  with its passage in every Gospel that tells it); the armour of God; the fall
  and redemption from Genesis 3 to Revelation 22 (the concept board's Genesis
  3, Romans 5 and Galatians strip); and Christ in prophecy (prophecy and
  fulfilment, with His return still ahead).
- **Any theme, built from the verses.** "Map any theme" sends the theme to
  `POST /api/beta/maps/generate`, which builds a draft only from verses it
  retrieves (see Generation). The draft opens in edit mode; nothing is saved
  until the founder presses Save map.
- **Explore.** Pan by dragging or swiping, zoom with a pinch, Ctrl+wheel (a
  trackpad pinch) or the toolbar, fit the whole map. Tap an idea to open its
  sheet: SureWord's short note, then every passage printed from the bundled
  KJV with a link into the reader at that verse, how the idea connects to its
  parent (with that connection's verses), and its links across the map. Tap a
  connection label or a cross-link to read the verses that show it. "Focus
  this branch" redraws the map as the path from the root to that idea and its
  whole branch. An Outline view gives the same map as a nested list.
- **Keyboard.** Tab reaches every idea in reading order; arrows travel the
  tree (right to the first child, left to the parent, up and down between
  siblings); Enter opens the sheet and Escape closes it, returning focus to the
  idea; + and - zoom, 0 fits.
- **Where Christians differ.** A `question` node holds two to four `reading`s,
  drawn side by side in a dashed frame headed "Interpretations, side by side ·
  none settled", each tagged Interpretation and carrying its own verses. The
  question's sheet repeats them as side-by-side cards. The library has five:
  how David's throne is fulfilled, whether a true believer can finally fall
  away, how long Christ's public ministry was, whose righteousness the
  breastplate is, and the thousand years of Revelation 20. SureWord's
  foundation (one God in three persons, the deity of Christ, salvation by grace
  through faith, His bodily resurrection and return) is taught, never offered as
  one reading among others; the test suite checks the Trinity map has no
  question at all.
- **Edit and save.** Edit mode (a generated draft, or a saved map) lets the
  founder change any idea's label, note and passages, its connection label and
  verses, where it sits, whether it is a question Christians read differently,
  add and delete ideas, and add, change or remove links across the map. A typed
  passage is checked against the KJV the moment it is added ("Acts 29:1" is
  refused, "acts 1:8" becomes "Acts 1:8"). Ready-made maps are read-only; "Save
  a copy to edit" makes the founder's own copy.

## Data

A map (`ConceptMap`, `src/lib/beta/maps/map-rules.ts`):

| Field | Meaning |
|---|---|
| `title`, `summary`, `topics` | Header text and up to eight lowercase topic labels |
| `nodes[]` | `id`, `parentId` (null only for the first node, the root), `label` (64), `note` (500, SureWord's words, never Scripture), `kind` (`topic`, `question`, `reading`), `refs` (1 to 12 passages), `via` (the connection from the parent: a label of up to 40 characters and 1 to 6 passages) |
| `links[]` | Cross-links between ideas that are not parent and child: `from`, `to`, `label`, `refs` (1 to 6) |
| `origin` | `library` (slug), `generated` (theme) or `custom` |

Passages are canonical KJV strings ("Romans 5:12-21", "Psalm 23", "Matthew
26:57-27:26", "Jude 1:24"); `checkConceptMap` parses every one, checks each
verse exists in the bundled KJV, and rewrites it canonically. It refuses a
loop, an orphan, a reading outside a question, a question with fewer than two
readings, a link that repeats a parent line or joins a pair twice, and any
node or link without verses. A connection with no verses of its own borrows
its idea's first passage, so every node and every edge carries verses.

**Saved maps are `BetaItem`s** in the shared study store, through
`src/lib/beta/store.ts` only (`src/lib/beta/maps/store.ts`): module `maps`,
kind `map`, `data.map` the map, `body` a plain-text outline the Knowledge Vault
indexes (every idea with its passages, questions and interpretations
labelled), `refs` every verse and chapter key of every passage (a lookup by
`44.2` or `44.2.4` finds a map citing Acts 2:1-4; past the store's 500-key cap
a range keeps its first verse and chapter), and `topics` the map's topics. No
table of its own, no migration. Account deletion already cascades. The Vault
opens a saved map as `/beta/study/maps?item=<id>`, which redirects to the
map's own page (and so to the ordinary 404 for anyone else's id).

## Generation (retrieval first, never memory)

`src/lib/beta/maps/generate.ts`, only when a founder asks:

1. **Plan** (the house utility model): the searches the theme needs and the
   books it is about ("the Holy Spirit in Acts" means Acts). It writes no map
   content, and may decline a theme Scripture does not speak to (422). It
   also decides whether faithful Christians genuinely read the theme
   differently (faith and works, the millennium, election, baptism, the gifts
   in Acts) and, when they do, names the question and two or three readings,
   each with its own search (LC-17678). A theme limited to one book still
   counts ("baptism in Acts"); a broader one ("the Holy Spirit in Acts") does
   not. Most themes get none.
2. **Retrieve**: `searchScripture` (pgvector plus keyword blending) for the
   theme and each search, and the KJV full-text index inside each named book,
   merged round robin into a pool of up to 96 verses whose text comes from the
   bundled KJV. Each named reading's search is one more list, so the verses
   its holders cite sit in the pool beside the others'.
3. **Build** (the house chat model, at the founder's plan effort): the model
   draws the map citing pool ids (`V12`) only, under SureWord's system prompt,
   interpretation guidance and a task that forbids leaning on remembered
   verses and keeps every reading inside the foundation. The plan's answer is
   in the prompt: one question with those readings side by side, or no
   question at all. (Left to choose for itself, the model skipped the question
   on faith and works, or set out the two books as its "readings".)
4. **Assemble and check** (`assembleGeneratedMap`, then `checkMapAgainstKjv`):
   ids outside the pool are dropped, an idea left with no verse is removed (its
   children move up), consecutive verses merge into ranges, and structural
   mistakes are repaired (a second root, a loop, a lone reading, a question with
   one reading). A flagged theme keeps its first question only and any other
   theme keeps none (`maxQuestions`), so no question is invented. Only a map
   that passes every check reaches the founder.

The route is wrapped in `withIncludedAiRequest(..., "beta-maps")`, so it is
metered like any included AI call. There is no pre-generation, backfill or
scheduled job; the ready-made maps are data.

## API (all founders only; everyone else gets the ordinary 404)

| Route | Does |
|---|---|
| `GET /api/beta/maps` | The founder's saved maps, newest change first |
| `POST /api/beta/maps { map }` | Saves a checked map (201), or 400 with the first problem |
| `GET`, `PATCH { map }`, `DELETE /api/beta/maps/[id]` | One saved map; someone else's id, or another module's item, is a 404 |
| `POST /api/beta/maps/generate { theme }` | A draft map (not saved); 400 bad theme, 422 off-topic or too few verses, 502 a draft that failed its checks |

## Files

- Pages: `src/app/beta/study/maps/page.tsx` (home), `src/app/beta/study/maps/[mapId]/page.tsx` (a ready-made slug, a saved id, or `new` for the unsaved draft, which lives in the tab's session storage per account)
- Components: `src/components/beta/maps/` (`MapsHome`, `MapScreen`, `ConceptMapCanvas`, `MapSheet`, `NodeEditor`, `MapOutline`, `usePassageTexts`, `draftStorage`)
- Logic: `src/lib/beta/maps/` (`map-rules.ts` pure rules and layout, `library-data.ts` the ready-made maps, `library.ts`, `passages.ts`, `generate.ts`, `store.ts`, `http.ts`)
- API: `src/app/api/beta/maps/**`
- Tests: `tests/beta-maps.test.mjs`

## Look and feel

Parchment and ink, gold as the one accent (the selected idea's ring and the
primary button), Cormorant labels, a quiet dotted canvas. Nodes are flat
rounded cards: the root in ink (gold in dark), branches white, deeper ideas
lighter, questions warm, interpretations dashed. No blur, glow, shadow or
animation on the repeating nodes. The sheet is a bottom sheet at 375px and a
side panel on desktop, so the map stays in view.
