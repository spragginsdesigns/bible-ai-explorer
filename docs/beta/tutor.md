# Socratic Tutor (`tutor`, Study)

**LC-17650.** A close-reading guide that asks before it tells, inspired by Khan
Academy's tutoring. The founder picks a passage and reads it in the KJV beside
a conversation in which the tutor asks one question at a time, moving from
observation to interpretation to application, and finally checks the
founder's own conclusion against the text. The point is that believers learn
to interpret Scripture thoughtfully instead of depending on AI answers.

Live at `/beta/study/tutor` for the founders only (`docs/beta/README.md`).

## What a founder can do

- **Start a close reading of any passage** of up to 30 verses in one chapter:
  type it ("Romans 5:1-11", "Jn 3:1-21", "Psalm 23"), tap a suggestion, or
  pick a book and chapter and tap the first and last verse. The chapter shown
  is the bundled KJV from the public chapter API the reader uses.
  `/beta/study/tutor?passage=James%202:14-26` opens the picker with a passage
  ready, so the reader or another module can link straight in.
- **Answer one question at a time.** The passage stays beside the
  conversation on desktop and above it on a phone, with the verses the open
  question points to highlighted and quoted under it. A question about a verse
  outside the passage (the chapter before, a cross-reference) shows that verse
  too.
- **Get a response to every answer**: the text supports it (affirmed with the
  verse), partly there (the true part affirmed, the verse that completes it),
  or look again (corrected gently with the verse that corrects it, then a
  narrower question so the founder reads it again for themselves; the tutor
  does not spell the answer out).
- **Ask for a hint** when stuck: up to three per question, a ladder from
  "look at verse 3 after the word knowing" to the exact words to a sentence to
  finish. Never the answer, never a lecture.
- **Ask for the tutor's own reading**, only on request: shown as "The tutor's
  reading · interpretation, not Scripture", with the verses for it and the
  verses a careful reader could genuinely weigh against it, or "None found in
  this passage and its context" when there is no such verse (never a forced
  one). It then hands the founder back to the question still open ("Back to
  your question: ..."); it never asks a new one.
- **Conclude**: state a conclusion in their own words, any time or when the
  tutor asks for it, and see it checked against the text as supported, partly
  supported or "the text says otherwise", with what supports it, what corrects
  or completes it, the wider context (the chapter before and the
  cross-references), and what the study shows. A checked conclusion closes
  the guided questions: after it the founder can restate the conclusion for a
  fresh check or ask for the tutor's reading, and the progress bar marks only
  the stages actually reached.
- **Study at their level**: Beginner, Growing or Deep study, chosen at the
  start and changeable in the session. The tutor adapts as they answer (below).
- **Pause and pick up**: every turn is saved as it happens; Pause returns to
  the list, and "Pick up where you left off" reopens any session at its live
  question. The session screen and the list read themselves fresh when they
  open, so Back or a quick reopen never shows a copy the router cached.
- **Save the session and what was learned as a note** in Notes: the passage,
  What I learned, the checked conclusion and the whole conversation. Saving
  again later appends only what happened since.

## How it works

| Piece | Where |
|---|---|
| Pages | `src/app/beta/study/tutor/page.tsx` (start and resume), `src/app/beta/study/tutor/[id]/page.tsx` (a session) |
| Components | `src/components/beta/tutor/` (`TutorHome`, `TutorPicker`, `TutorSession`, `TutorTurns`, `tutor-api.ts`) |
| Server | `src/lib/beta/tutor/tutor.ts` (grounding, the model, citations, store, note), `http.ts` (route helpers) |
| Pure rules | `src/lib/beta/tutor/tutor-rules.ts` (stages, adapting, actions, transcript, note markdown), `passage.ts` (reading a typed passage) |
| API | `src/app/api/beta/tutor/sessions/**` (below) |
| Tests | `tests/beta-tutor.test.mjs` |

### The model

Every founder action is **one** structured call (`generateText` with
`Output.object`, AI SDK 7) to the house model through `resolveModel` at low
effort, the same way Quiz me calls it, so a turn comes back in about 3 to 8
seconds. The instructions are SureWord's `doctrinalFoundation` and
`interpretationGuidance` (`src/utils/systemPrompt.ts`) followed by the tutor's
own role, a brief for the level, and the task for this action. Calls are
metered like every included AI surface (`withIncludedAiRequest`, surface
`beta-tutor`) and pass the AI consent gate on the client. Nothing is generated
except when the founder acts: no pre-generation, no backfill, no cron.

**Grounding.** Each call reads, verse by verse with bracketed labels, the
passage, the rest of its chapter, the whole chapter before (none for a book's
first chapter), up to 36 bundled cross-references taken round-robin from the
passage's verses, and, for answers and conclusions, up to 6 verses that
`searchScripture` finds for the founder's own words. That is the wider
context the conclusion check draws on.

**Scripture is never the model's.** The model cites verses by reference only.
`resolveCitation` reads "Romans 5:8", "Rom 4:3-5", "5:8" or "verse 8", keeps
only verses that were in the grounding (anything else is dropped, never
invented), holds a range to 4 verses, and takes the text from the bundled KJV.
Each citation is labelled with where it came from: in the passage, same
chapter, the chapter before, cross-reference, or elsewhere in Scripture. The
reference that ends each "what I learned" line goes through the same check,
and is dropped (the sentence kept) when it names a verse outside the
grounding.

**One question at a time.** Questions ask about one thing; anything after a
second question mark is cut, question sentences are dropped from the tutor's
response to an answer and from its reading, and the reading ends by repeating
the open question rather than asking its own, so only one question is ever
open.

### Stages and adapting

A session moves observation, interpretation, application, conclusion. A stage
opens the next once enough of its questions were answered in a way the text
supports (affirm or partly): Beginner 3, 2, 1; Growing 2, 2, 1; Deep study
2, 3, 1. A corrected answer holds the stage for a look-again question, but a
stage moves on anyway after two extra questions so nobody is stuck. The model
is told which stage each verdict leads to; the server files the question by
the verdict, never by the stage the model claims. A stage already passed is
never reopened, so moving to a harder level mid-session (by the founder or the
tutor) raises what the stages ahead ask, not the ones behind. The conclusion
question is always the same ask ("In a sentence or two of your own, what does
Romans 5:1-11 teach?"), never one the model writes, because its answer is
checked as the founder's conclusion.

The level steps **deeper** after two answers in a row the text fully supports,
with no hints, when the model also reads the answer as close reading beyond
the question; it steps **easier** after two misses in a row, or a second hint
on one question, when the model also sees struggle. Never within two answers
of any change, so a founder's own choice stands. Each change shows in the
conversation ("Going deeper ...", "Let's slow down ...", "You moved to ...").

## Data

One `BetaItem` per session in the shared study store, through
`src/lib/beta/store.ts` only:

- `module: "tutor"`, `kind: "session"`, top level (`parentId` null).
- `title`: "Close reading: Romans 5:1-11".
- `body`: plain text for the Knowledge Vault: the questions, the founder's own
  answers and conclusions, the tutor's reading (labelled interpretation) and
  what was learned.
- `refs`: every studied verse and every verse the session cited (the store
  adds each chapter's key and keeps them in canonical order). Verse keys are
  held to half the store's 500, since each can bring its chapter key; a
  session within 32 KB of the store's data cap takes no new turn and asks for
  a fresh session instead.
- `topics`: 1 to 3 labels from the opening read of the passage, plus any from
  the conclusion check.
- `data` (`TutorSessionData`, `v: 1`): the passage, level,
  `answersSinceLevelChange`, `finished`, `pausedAt`, `noteId`, `noteTurns` and
  the turns. A turn is the founder's (answer, conclusion, hint request,
  reading request) or the tutor's (question, feedback, hint, reading, check,
  level change), each with its citations and their KJV text.

The note is an ordinary `Note` written through `appendMarkdownToNote`
(`src/lib/notes-io.ts`), so it gets wikilinks, backlinks and embeddings like
any note. No table of its own, no migration.

## API

All founders only: anyone else gets the ordinary 404 (`requireBetaApi`).

| Route | Does |
|---|---|
| `GET /api/beta/tutor/sessions` | `{ sessions }`, newest first |
| `POST /api/beta/tutor/sessions` `{ passage, level }` | checks the passage against the KJV, asks the first question, `201 { session }` |
| `GET /api/beta/tutor/sessions/:id` | `{ session }` with the passage text |
| `PATCH /api/beta/tutor/sessions/:id` `{ level?, paused? }` | the founder's level, or pause |
| `DELETE /api/beta/tutor/sessions/:id` | deletes it |
| `POST /api/beta/tutor/sessions/:id/turn` `{ action, text?, expect }` | `answer`, `hint`, `reading` or `conclude`; `expect` is the turn count the screen shows, and a stale or doubled send is `409` |
| `POST /api/beta/tutor/sessions/:id/note` | saves or updates the note |

A missing, foreign or other module's id is a 404, like any missing item.

## For other modules

The tutor is the beta's guided-questioning foundation (`expansion.md`):
Academy's tutor checkpoints and Learning Paths build on it rather than beside
it. Link to `/beta/study/tutor?passage=<reference>`, or start one on the
server with `resolvePassage` and `startSession` from `src/lib/beta/tutor/tutor.ts`
and send the founder to `/beta/study/tutor/<id>`. If a module needs sessions
nested under its own items, extend `startSession` with a `parentId`
backwards-compatibly.

## Proof

See the LC-17650 closeout on Linear for the full sessions and screenshots.
