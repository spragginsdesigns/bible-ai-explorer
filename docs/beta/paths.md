# Learning Paths (`/beta/learn/paths`, LC-17648)

Duolingo-style courses through Scripture for the founders-only beta (Jay,
LC-17631: "like fledged out duolingo style things"), plus the issue's big idea
C, the personal theology curriculum. Module `paths` in
`src/lib/beta/modules.ts`, built to the contract in [README.md](README.md).

## What a founder can do

- **Take a path.** Four written paths of twelve lessons each, in units:
  Foundations of the Christian Faith (beginner friendly), Mastering Romans,
  How to Read and Interpret Scripture, and The Life of Paul.
- **Take a lesson.** Read the passage (the bundled KJV) with a short teaching
  labelled as teaching, then six questions: multiple choice, fill in the blank,
  put in order, and match the verse to its truth. Feedback is instant and
  always shows the verse that answers it, with "Read in context". The lesson
  closes with a written reflection (saved to Notes on request) and the verse
  to carry (one tap adds it to Learn a verse).
- **Follow the map.** Units, lessons done, up next and locked, a checkpoint at
  the end of each unit ("test your understanding"), a progress bar, and
  "Resume" at the exact question after leaving mid-lesson, on any device.
- **Review.** Every question missed the first time is asked again at the end
  of the lesson, goes on the path's review list, and comes back in later
  lessons (two per lesson) and in "Review missed" until it is answered right
  the first time. No hearts, no streaks to lose, nothing locked by a wrong
  answer.
- **Adapt.** Mastery is kept per concept ("justification", "god's word") across
  every path. A concept still being learned gets the foundational questions;
  once mastered (strength 4 of 5) its level 1 questions are skipped and the
  deeper level 3 questions are asked. The path page shows what you have shown:
  learning, growing, mastered, and what is coming back.
- **Build a curriculum.** Name any topic (the covenants, the Holy Spirit,
  eschatology) and get a path through Scripture with its foundations first.
  The outline is written when asked; each lesson's questions are written the
  first time it is opened. The map shows what is covered and what is next, and
  the unit checkpoints test understanding.
- **Read along.** Each written path suggests a reading plan through the app's
  own Reading plans (The Gospels in 30 days, Psalms and Proverbs in 31 days,
  or a goal plan for Romans and Acts). A founder already on a plan sees that
  plan instead, because plans are one at a time.

## Content: written once, checked against the KJV

Written paths are TypeScript data in `src/lib/beta/paths/content/`, shaped by
`paths-types.ts`. Content never carries Scripture text; every passage is a
reference resolved against the bundled KJV when a lesson is served.

`tests/beta-paths-content.test.mjs` checks every path against the bundled KJV
with `content-rules.ts`, which uses Quiz me's own grounding rules
(`src/lib/quiz-rules.ts`):

- every reference exists (one chapter, readings at most 25 verses);
- every right answer, ordered step and matched truth is in the words of the
  verse it cites, and no wrong answer is something the verse says;
- a matched truth fits its own verse better than the others in the match;
- a blanked word is in its verse exactly once, as written;
- each lesson has seven to ten questions with at least two multiple choice, a
  blank, an order and a match, and at least one level 1 and one level 3;
- no dashes or markdown in any text.

Each path was then read lesson by lesson for doctrinal care: what the text
plainly says, the historic truths affirmed clearly, and no side taken on
debates among Bible-believing Christians (election, end-times schemes, the
mode of baptism, sign gifts). Wrong answers that Scripture affirms elsewhere
were replaced.

## Data (the shared study store)

All in `BetaItem`, module `paths`, through `src/lib/beta/store.ts`. No table of
its own, no migration.

| kind | one per | `data` | also |
|---|---|---|---|
| `learner` | founder | `{ v, concepts: { [concept]: { s, r, w, at } } }`: strength 0-5, right, wrong, last seen | `body` lists mastered, growing and learning concepts; `topics` are the mastered ones |
| `enrollment` | started path | `{ v, pathId, startedAt, lessons, checkpoints, review, active, lastLesson }` (`EnrollmentData`) | `refs` are every verse of the lessons done; `parentId` is the curriculum for a personal path |
| `curriculum` | personal path | `{ v, topic, title, description, units, written, model }` (`CurriculumData`) | `body` is the outline; deleting it deletes its enrollment |

`active` is the session in progress (its questions in order, the answers so
far), which is what makes "resume at the same question" work across tabs and
devices. Starting a path over deletes its enrollment and keeps the learner's
mastery.

## Rules (pure, tested)

- `progress-rules.ts`: choosing a session's questions (one of each type, the
  best fit for each concept's level, weaker concepts first), review picks,
  grading, recording an answer, the map's locks, and reading stored data
  defensively. Options are ordered with Quiz me's `arrangeOptions`/`seedHash`,
  so the browser and the server see the same order.
- `player-rules.ts`: the browser's instant grade (it must equal the server's;
  the tests check every written exercise), and the taps that build a response.
- `content-rules.ts`: content checks (above) and the personal curriculum's
  checks.

## The personal curriculum and the AI

- `POST /api/beta/paths/curriculum` `{ topic }`: one structured call on the
  house model (`resolveModel`, as Quiz me) with SureWord's system prompt,
  given candidate verses from `searchScripture`. The outline must put the
  foundations first; every passage is checked (one chapter, 3 to 20 verses,
  real verses), lessons that fail are dropped, and fewer than four good
  lessons is refused.
- `POST /api/beta/paths/curriculum/<pathId>/lessons/<lessonId>`: the first
  time a lesson is opened, one call writes its teaching and questions from the
  reading's own verses; every question goes through the same checks as the
  written paths, failures are dropped, and fewer than two multiple choice or
  four questions in all is retried once and then refused. A written lesson is
  never written again.
- Spend: AI runs only when a founder asks (building a curriculum, opening an
  unwritten lesson). No backfill, no pre-generation, no schedule. Both routes
  ride the included-AI meter (`withIncludedAiRequest`, surface `beta-paths`),
  ask for AI consent on the client (the app's consent sheet) and check stored
  consent on the server. A founder keeps up to 12 curricula.

## Pages and API

| Path | What |
|---|---|
| `/beta/learn/paths` | Hub: continue, the four paths, your curricula and the builder |
| `/beta/learn/paths/<pathId>` | The map; `<pathId>` is a written path's id or `c-<item id>` |
| `/beta/learn/paths/<pathId>/<lessonId>` | A lesson |
| `/beta/learn/paths/<pathId>/review` | Review missed questions |
| `/beta/learn/paths/<pathId>/checkpoint?unit=<unitId>` | A unit checkpoint |
| `POST /api/beta/paths/session` | Start or resume a session `{ pathId, kind, target, restart? }` |
| `POST /api/beta/paths/answer` | Grade and record the current question; 409 when the session moved on |
| `DELETE /api/beta/paths/enrollment?pathId=` | Start a path over |
| `POST /api/beta/paths/curriculum` | Build a curriculum |
| `DELETE /api/beta/paths/curriculum/<pathId>` | Delete one |
| `POST /api/beta/paths/curriculum/<pathId>/lessons/<lessonId>` | Write a curriculum lesson |

Every page calls `requireBetaPage()` and every route `requireBetaApi()`; anyone
off `BETA_USER_IDS` gets the ordinary 404.

## Built on

Quiz me (its grounding rules and option order; the "answer is the verse" rule),
Learn a verse (`AddLearnButton`), Reading plans (`useReadingPlan`), Notes (the
reflection is saved with Quiz me's `saveReflectionNote`), Scripture search (the
curriculum's candidate verses), the bundled KJV and the house model.

## For SureWord Academy (LC-17660) and later courses

Paths is the course engine. A new written course is a `PathDef` file in
`src/lib/beta/paths/content/` and a line in `catalog.ts`; the content test
checks it like the others, and progress, review, checkpoints and adaptivity
come with it. Extend the shapes backwards-compatibly (an optional field on
`PathLesson` or `PathDef`), keep `progress-rules.ts` pure, and keep exercise ids
unique across every course.

Academy did exactly that ([academy.md](academy.md)): its three courses are
`PathDef` files listed in `WRITTEN_COURSES` (served by `loadPath` and the
session and answer routes, not listed on this hub), with optional `course`
fields on the path and its lessons, a `"final"` session kind for a course's
final review, and `base`, `leaveHref` and `continueTo` on `LessonPlayer` so the
same player runs under `/beta/learn/academy`. Paths' own behaviour is
unchanged. A course's path pages redirect to Academy, and
`DELETE /api/beta/paths/enrollment` answers 404 for a course: it is started
over in Academy, which clears its milestones with its progress.

## Proof (LC-17648, 2026-10-27)

A production build on a Neon branch of `versemind`, signed in with Clerk
sign-in tokens, driven by Puppeteer: 106 checks, all passing.

- **Desktop, 1280, light and dark (62).** A fresh founder: the hub, the map
  (lesson 1 up next, the rest and every checkpoint locked), lesson 1 read and
  answered with two misses, left mid-lesson and resumed at "question 4 of 6",
  each miss asked again at the end, the reflection saved to Notes and the key
  verse added to Learn, "4 of 6 the first time". Lesson 2 brought both misses
  back as "From an earlier lesson"; Review cleared the next miss; lessons 3 and
  4 opened the unit checkpoint (8 of 8). Every answer showed its verse; no
  console errors.
- **Adaptive.** After "god's word" reached strength 5, How to Read and
  Interpret Scripture lesson 1 skipped both of its level 1 "god's word"
  questions (01.1, 01.4) that a fresh learner is asked, and asked 01.5 and
  01.8 instead; the unit checkpoint asked none of its level 1 questions.
- **375px with touch, dark (14).** Mastering Romans lesson 1 by touch, every
  exercise type, a miss and its retry, no overflow, every target at least
  44px, and Check above the tab bar.
- **Curriculum (14).** "Eschatology" built in about 15 s (God's promises to
  Abraham and Christ in the Scriptures first, then the Lord's coming and the
  resurrection, then judgment and the new creation), its first lesson written
  on open in about 11 s and taken; "The covenants" built from a suggestion by
  touch (Noah, Abraham, Sinai, David, the new covenant).
- **Negative control (16).** An account off `BETA_USER_IDS` got the ordinary
  404 on every page and route; signed out, the page redirects to sign-in and
  the API answers 401; unknown ids, a locked lesson, a stale session, a junk
  response and bad topics are refused without recording anything.
