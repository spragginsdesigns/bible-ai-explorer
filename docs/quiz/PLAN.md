# Quiz me: a short quiz after a study

**Status:** Planned (2026-10-25). Not built. Idea from David Rowan, closed-testing
coordinator, 2026-10-23: "why not add a Bible quiz feature that users can explore
after their Bible studies?"

Concept mockups (gpt-image-2.5-sunburst, prompts in the matching `.json` files):

| File | Shows |
|---|---|
| `mockups/mobile-1-entry.png` | End of a chapter in the Android reader: "Chapter read", then the "Quiz me on John 3" card |
| `mockups/mobile-2-question.png` | A question, its source verse labelled, four answers, "Show me the verse first" |
| `mockups/mobile-3-answer.png` | After answering: the KJV verse itself, the original-language word, Read in context / Ask about this |
| `mockups/mobile-4-results.png` | "You remembered 4 of 5", the missed question with its verse, Learn this verse, a reflection to save as a note |
| `mockups/web-1-question.png` | Web: chapter on the left with the source verse lit, question on the right, keyboard answers |
| `mockups/web-2-results.png` | Web results: every question with its reference, the miss expanded, reflection panel beside it |

The mockups are concepts, not specs: the image model paraphrased some distractors
and the web results list repeats a question. The rules below are the contract.

## What it is for

A quiz is not a game here. It is a way to slow down on the passage someone just
read, find the verse they skimmed past, and carry one truth out of it. Every
choice below follows from that.

1. **The answer is always the verse.** Every question names its source verse
   before it is answered, and every answer, right or wrong, is followed by the
   KJV text of that verse. The person leaves with Scripture, not a score.
2. **Wrong answers send you back to the Word, not to a penalty.** No hearts, lives,
   XP, streaks, badges, leaderboards or confetti, the same rule Learn already
   keeps ("the only number a client shows is verses you know"). The result line is
   "You remembered 4 of 5", and the miss is shown as "the one worth another look".
3. **It meets each person where they are.** The same chapter has three depths,
   chosen from what SureWord already knows about the reader (`loadStudyContext`):
   - *Seeking* (not yet saved, or new): who, what, where, and what Jesus said.
     "What did Jesus tell Nicodemus must happen?"
   - *Growing*: what a verse teaches and how verses in the chapter fit together.
     "Why does verse 5 add 'of water and of the Spirit'?"
   - *Deep*: cross-references and the original words. "'Again' in verse 3 is
     *anothen* (G509). Where else does John use it?"
   The reader can change the depth from the quiz header; the default is never
   announced as a label on the person.
4. **It ends in the walk, not the score.** The last card is one reflection prompt
   from the chapter's central verse ("John 3:16 says God so loved the world. What
   does that change about today for you?"), saved as a note if they want. Misses
   get a one-tap "Learn this verse" into the existing memorisation ladder.

## Where it appears

- **End of a chapter in the reader**, after the chapter counts as read (the
  existing ~5 s `POST /api/reading-events`). One card, dismissible, with "Not now"
  remembered per chapter. Never a modal, never before reading. Always
  optional: the card is an offer under the last verse, reading on to the next
  chapter skips it, and Settings has "Offer a quiz after each chapter" (on by
  default) for anyone who never wants to see it.
- **A finished reading-plan day**: "Day 12 done. Quiz me on today's reading"
  covers the day's chapters (5 questions spread across them).
- **Chat**: a `startQuiz` tool so "quiz me on what we just studied" renders the
  same inline quiz card inside the conversation, and the assistant can offer it
  after a long study. Chat already quizzes Learn verses; this is the same
  pattern for comprehension.
- **Today**: no new tile in v1. Add one only if usage shows people want it.

## How a quiz is built (server, shared by every client)

`GET /api/quiz?book=43&chapter=3&depth=seeking`

1. **Bank lookup.** `QuizBank` is an account-free cache keyed
   `[book, chapter, depth]`, like `VerseInsight` and `VerseWordStudy`. Hit means no
   model call. Worst case is 1,189 chapters x 3 depths, generated lazily once each.
2. **Generation on a miss.** One `resolveModel({ utility: true })` structured call
   (`Output.object`; every optional field `.nullable()`, never `.optional()`, or
   OpenAI strict schemas 400). Input is the bundled KJV chapter text with verse
   numbers, the doctrinal persona and the depth brief. It asks for 8 questions so
   validation can drop some and still leave 5.
3. **Validation, mechanical, before anything is stored** (`src/lib/quiz-rules.ts`,
   pure, tested like `reading-plan-presets.ts`):
   - every `sourceVerses` reference exists in that chapter of the bundled KJV;
   - the correct answer's key words appear in the source verse text (case and
     punctuation folded), so an answer the verse does not say is dropped;
   - no distractor appears in the source verse, and the 4 options are distinct;
   - cross-reference verses (deep depth) resolve against the bundled KJV, and
     Strong's numbers against `src/data/originals`;
   - dashes stripped, as every SureWord answer.
   Fewer than 5 survivors means retry once, then return `unavailable` (the
   entry card hides itself, the same rule as Listen and My church).
4. **Response.** Questions with the verse text attached from the KJV bundle,
   never from the model. The client never needs a second call to show the verse.

`POST /api/quiz/attempt { bankId, answers }` stores a `QuizAttempt` (userId,
book, chapter, depth, answers, score, createdAt). Misses feed `loadStudyContext`
so the daily cross or the reading reflection can come back to a verse that did
not stick. Attempts are deleted with the account (`ACCOUNT_DATA_MODELS`).

**Consent.** Generation is a user tap, so it is an explicit AI request under
`ai-consent-gate`; a cached bank needs no AI call at all. The reflection note goes
through the normal notes path.

**Analytics.** PostHog `quiz_started`, `quiz_finished` (depth, score, entry
point). No question or answer text, per the no-study-content rule.

## Parity

Android first (`mobile/src/features/quiz/`, entry on the reader and plan
screens), then web (`src/components/quiz/`, the two-column layout so the chapter
stays visible beside the question), then macOS and iOS
(`macos/Shared/Quiz/`). One API, so every client shows the same questions.
`docs/PARITY.md` gets a Quiz row when the first client ships.

## Phases

1. **v1**: reader end-of-chapter entry, seeking/growing depths, 5 multiple-choice
   questions, verse after each answer, results with Learn this verse and the
   reflection note. Android, then web, then Apple.
2. **v2**: reading-plan day quiz, `startQuiz` chat tool, deep depth with
   original-language questions.
3. **Later, only if used**: fill-in-the-word questions borrowed from the Learn
   ladder, a quiz over a whole book, a quiz shared to a friend through the
   existing share links.

## Decisions (Austin, 2026-10-25)

- **Free for everyone**, every depth. No part of the quiz sits behind Pro.
- **Offered after every chapter, always optional**: dismissible per chapter,
  skipped by reading on, and switchable off in Settings. Never required to
  finish a chapter or a plan day.
