# Scripture Memory (`/beta/learn/memory`)

**Issue:** LC-17651 (Jay, from LC-17631's study-platform board: "Intelligent
Scripture Memory, inspired by Anki and Readwise"). Founders only, web only,
under the beta contract in `docs/beta/README.md`.

## What it is

A richer way to practise the verses in **Learn a verse**, not a second deck.
The cards are Learn a verse's `VerseMemory` rows and the schedule is Learn a
verse's ladder (`src/lib/learn-schedule.ts`): every answer here is sent to
`POST /api/learn/[id]/review` as `good` or `again`, with the card's
`expectedRevision`, an `operationId` and the browser's timezone, exactly as the
Learn a verse screen sends one. A review here is a review there, and the
reverse.

- **Today's review** (`/beta/learn/memory/review`): the due cards, at most ten
  per round (the board's "1/10"), the longest-waiting first. A segmented bar
  shows the cards done, the header shows the step and how many are due today.
  Every answer is graded on the spot; the result shows the right text, saves the
  review, and says what Learn a verse's schedule now holds ("Back later in this
  session, step 3 of 4" or "Next review in 4 days (Fri, Oct 30)"). A card with a
  step left today comes back two cards later, as the ladder says it must.
- **Five exercises**, chosen by where the card stands on the ladder, with "Try
  another way" to switch:

  | Exercise | Default at | How it is graded |
  |---|---|---|
  | Multiple choice | step 1 (stage 0) | the passage with one word blanked and four words to choose (A to D) |
  | Fill in the blank | step 2 (stage 1) | Learn a verse's own mask for the stage (`verseWords`), each blank typed |
  | First letters | step 3 (stage 2) | type the first letter of every word; the verse fills in as you go |
  | Type the whole verse | step 4 (stage 3) | from the reference alone, word by word (`scoreTypedVerse`) |
  | Comprehension | every other turn at steps 2 and 3, once written | a question answered by the verse's own words, verse out of sight |

  Right sends `good`, wrong sends `again`. A single slip, or up to one
  mistake in ten in a long recall (`gradeRecall`), is the founder's call: "Count it
  as remembered" or "Practise it again", the way Learn a verse lets the reader
  decide on its self-checked modes.
- **Make cards**: type any verse or passage (up to six verses of one chapter,
  so Ephesians 2:8-9 is one card) and see it in your translation before adding
  it; or "Find verses in my study", which lists verses and passages from your
  highlights (side-by-side highlights join into a passage), saved studies
  (`AgentStudy.state.passages`), notes (references written in them), other
  beta modules' items (`BetaItem.refs`, each run of verses whole: a reading
  longer than six verses, such as a Learning Paths lesson's Ephesians 2:1-10,
  is left out rather than cut; the lesson's own key verse is offered to Learn a
  verse in the lesson) and recent chats (verses the assistant
  quoted), each with the record it came from, with anything already in your
  cards left out. Nothing is added until you tick it and tap Add. Adding goes
  through Learn a verse's `addCard`, so a verse already there keeps its
  schedule.
- **What you know**: known, learning and due, by book and by verse, with each
  card's step and when it comes back. "Known" is Learn a verse's `knownAt` (the
  first 16-day interval), the same number its screen counts.

## Data

No table of its own. It reads `VerseMemory` and writes it only through
`addCard` and Learn a verse's review route. Its own records are in the beta
study store (`src/lib/beta/store.ts`), module `memory`:

| kind | What | refs | data |
|---|---|---|---|
| `passage` | verses learned as one card (Ephesians 2:8-9); an overlapping add joins them, never past six verses | each verse key (`49.2.8`, `49.2.9`) | `{ book, chapter, start, end }`; `body` is the passage text |
| `questions` | the comprehension questions written for one card in one translation; a new set replaces the old | each verse key | `{ book, chapter, start, end, translation, questions: QuizQuestion[], model, promptVersion }` |

A passage whose verse was removed in Learn a verse falls back to its
consecutive verses (`planUnits`). Account deletion already cascades both.

## AI and spend

Only comprehension questions use AI, and only when a founder asks: "Also write
comprehension questions" when adding (shown, ticked, before Add), or "Write
questions" on a card. `POST /api/beta/memory/questions` checks the account's AI
consent, runs the house model at low effort through `withIncludedAiRequest`
(surface `beta-memory`), and keeps at most three questions that pass Quiz me's
`validateDraft`: the right answer must be the verse's own words, no wrong
answer may be something the verse says, and no right answer may give itself
away by length. Verse text comes from the bundled Bible, never the model. No
backfill, no pre-generation, no scheduled job.

## Code

| What | Where |
|---|---|
| Pages | `src/app/beta/learn/memory/page.tsx`, `src/app/beta/learn/memory/review/page.tsx` |
| API (all `requireBetaApi()`) | `src/app/api/beta/memory/route.ts` (overview), `session/`, `candidates/` (study suggestions, or `?reference=` preview), `cards/` (add), `questions/` (AI) |
| Rules (pure, tested) | `src/lib/beta/memory/memory-rules.ts` |
| Server | `src/lib/beta/memory/memory.ts`, `src/lib/beta/memory/memory-questions.ts` |
| Components | `src/components/beta/memory/` |
| Tests | `tests/beta-memory.test.mjs` |

## Proof

See LC-17651 for the closeout: a production build on a Neon branch, signed in
as the founder stand-in, adding real verses (John 3:16, Psalm 119:105,
Ephesians 2:8-9 as a passage and cards from highlights and a note), reviewing
right and wrong in every exercise, the `VerseMemory` rows and
`LearnReviewReceipt` rows before and after, the Learn a verse screen showing
the same stages, 1280 and 375px with touch (typing included), light and dark,
and the off-list account's 404 on every page and route.
