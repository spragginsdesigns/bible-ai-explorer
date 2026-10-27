# SureWord Academy (`/beta/learn/academy`, LC-17660)

Bible courses with a beginning and an end, for the founders-only beta (Jay,
LC-17639: "brainstorm and build these out within the founders version"). Module
`academy` in `src/lib/beta/modules.ts`, built to the contract in
[README.md](README.md) and the brief in [expansion.md](expansion.md) → SureWord
Academy. A course is a longer, deeper Learning Path, never a second learning
engine: its lessons, questions, review, checkpoints and adaptivity are Learning
Paths' own (LC-17648), its close readings are the Socratic Tutor's (LC-17650)
and its memory verses are Scripture Memory's (LC-17651).

## What a founder can do

- **Enroll in a course.** Three courses of twelve lessons each, in four units:
  **Old Testament Survey** (Genesis to Jeremiah: creation, the fall, Abraham,
  the Passover, Sinai, the Shema, Joshua, David's throne, the exile and
  return, Psalm 1, Isaiah 53, the new covenant), **New Testament Survey**
  (Luke 2 to Revelation 21: the Gospels, the cross and the empty tomb, Acts,
  Hebrews, James, 1 John, the Lord's return, all things new) and **The
  Doctrines of the Faith** (Scripture, the one true God, the Trinity, sin, the
  Person of Christ, redemption by His blood, the new birth, justification by
  faith, the Spirit of truth, the church, the resurrection, the day of the
  Lord). Each course page lists what it teaches, its units, and every lesson.
- **Take a lesson in three parts**, each shown as to do, started or done:
  1. **Read and answer.** The passage from the bundled KJV with a short
     teaching labelled as teaching, then the lesson's questions in Learning
     Paths' own player: every answer is the verse, a miss comes back at the
     end, and it closes with a reflection and the verse to carry.
  2. **Read it closely with the tutor.** The Socratic Tutor takes the founder
     through the lesson's passage one question at a time, with one line of
     "what to look for" written for the lesson. The part is done once the
     founder's own conclusion has been checked against the text.
  3. **Hide it in your heart.** The lesson's one to three verses, each added to
     Scripture Memory in one tap, where Learn a verse's schedule brings them
     back.
- **Reach milestones.** A lesson is complete when all three parts are done; a
  unit when its lessons are complete and its checkpoint ("test your
  understanding") is taken; the course when every unit is and its final review
  is taken. Each one is recorded with its date and shown as it is reached
  ("Lesson 1 complete: Creation", "Unit 1 finished: In the Beginning", "You
  completed Old Testament Survey"). A milestone says what was finished, never
  how well anyone is doing: nothing grades anyone's spiritual maturity, and
  the record holds no scores.
- **Keep a record.** Completing a course writes a record the founder can open
  from the hub and the course: the dates, every lesson read and its passage,
  the verses memorized, and a link to each close reading. Starting a course
  over clears its lessons and milestones and keeps the record, the close
  readings, the memory cards and what the founder has shown of each truth.
- **Review and continue.** "Continue" goes to the first open lesson with a part
  left, then a checkpoint, then the final review. Missed questions come back
  in later lessons and in "Review missed", as in every learning path. Each
  course suggests a read-along plan where one fits (the whole Bible in a year,
  the New Testament in 90 days).

## How a course is a learning path

Paths was extended backwards-compatibly, as its own doc invites
([paths.md](paths.md) → For SureWord Academy):

| Extension | Where | What it changes for paths |
|---|---|---|
| `PathDef.course?: { outcomes }` | `paths-types.ts` | Nothing; marks a course |
| `PathLesson.course?: { tutor, focus, memory }` | `paths-types.ts` | Nothing; a course lesson's tutor passage, what to look for, and memory verses |
| `SessionKind` `"final"`, `EnrollmentData.final?` | `paths-types.ts`, `progress-rules.ts` | A course's final review: 12 questions shared across its units, open once every unit checkpoint is done. A path has none (`final: "none"`), and enrollments written before it read the same |
| `courseLessonProblems`, `COURSE_LIMITS` | `content-rules.ts` | Courses only: the tutor passage is 3 to 30 verses of one chapter (the tutor's own limit), each memory verse fits one Scripture Memory card (up to six verses), the key verse is one of them, three to five outcomes |
| `WRITTEN_COURSES`, `writtenCourse` | `catalog.ts` | Courses are served by `loadPath` and Paths' session and answer routes like any written path, but are not listed on the Paths hub; `/beta/learn/paths/<course>` goes to Academy |
| `LessonPlayer` `base`, `leaveHref`, `continueTo`; href helpers' `base` | `LessonPlayer.tsx`, `ui.ts` | Defaults are Paths' own URLs; Academy serves the same player under `/beta/learn/academy` |
| `TutorSession` `back` | `TutorSession.tsx` | Defaults to the tutor's list; a lesson's close reading returns to the lesson |

## Content: written once, checked against the KJV

The courses are `PathDef` files in `src/lib/beta/paths/content/`
(`ot-survey.ts`, `nt-survey.ts`, `doctrines.ts`), 36 lessons and 312
questions, written in this run. They carry references, never Scripture text.
`tests/beta-paths-content.test.mjs` checks them with the same rules as every
written path (each right answer, step, truth and blank is in the words of the
verse it cites; no wrong answer is something the verse says) and
`tests/beta-academy.test.mjs` adds the course checks. Each lesson was then
read against the KJV for doctrinal care: Scripture first, interpretation
labelled as teaching, the historic truths stated plainly (creation, the fall,
the virgin birth, Christ truly God and truly man, His atoning blood, bodily
resurrection and return, the new birth, justification by grace through
faith), and no side taken on debates among Bible-believing Christians
(election, end-times schemes and rapture timing, the mode of baptism, sign
gifts, church government). Wrong answers that Scripture affirms elsewhere
were replaced.

## Data (the shared study store)

Module `academy`, through `src/lib/beta/store.ts` only. No table of its own, no
migration. What the other modules own stays theirs: a course's progress is the
founder's Paths `enrollment` item (module `paths`), a close reading is a tutor
`session` item (module `tutor`), and a memory verse is a Learn a verse card
(`VerseMemory`), read through `memoryOverview`.

| kind | one per | `data` | also |
|---|---|---|---|
| `course` | enrolled course | `{ v, courseId, enrolledAt, milestones: { "lesson:<id>" \| "unit:<id>" \| "course": at } }` (`AcademyCourseData`) | `body` is the lessons completed; `refs` are their readings; deleted by "Start the course over" |
| `record` | completed course | `{ v, courseId, title, enrolledAt, completedAt, units: [{ id, title, completedAt, lessons: [{ id, title, reading, memory, tutor, tutorSessionId, completedAt }] }] }` (`AcademyRecordData`) | `body` lists every lesson and passage for the Knowledge Vault; kept when the course is started over |

A lesson's tutor part is matched by its passage: any of the founder's close
readings of exactly that passage counts, and the one still open is the one the
lesson opens. Its memory part is done when every verse of every memory
reference is in the founder's cards. A lesson recorded complete stays
complete if a card is later removed in Learn a verse. The tutor's list holds a founder's 60 most
recent close readings, so a close reading older than that no longer counts for
a lesson not yet complete; a completed lesson is unaffected.

**Milestones are written on request, never while rendering.** The course and
lesson pages work out what is reached from the founder's lessons, tutor
sessions and cards, and when something is reached but not yet recorded the
page asks `POST /api/beta/academy/milestones` once it opens. The write is
conditional on the `course` item being unchanged since it was read (the
store's `ifUpdatedAt`), so a double tap or two tabs record each milestone
exactly once. A course's record is keyed by its enrollment (one completion per
enrollment): a request that reads the course milestone before its record exists
may write a second copy, so every request that writes one then keeps the
oldest copy for that enrollment and deletes the rest (`splitDuplicateRecords`),
and the hub and course page show one record per completion. A record whose
write failed is made the next time a course or lesson page opens: the page sees
the course recorded complete with no record (`recordIsMissing`) and asks for it.

## Pages and API

| Path | What |
|---|---|
| `/beta/learn/academy` | Hub: continue, the courses, your record |
| `/beta/learn/academy/<course>` | The course: outcomes, units, lessons and their parts, checkpoints, final review, milestones |
| `/beta/learn/academy/<course>/<lesson>` | A lesson's three parts |
| `/beta/learn/academy/<course>/<lesson>/quiz` | Part one, in Paths' player |
| `/beta/learn/academy/<course>/<lesson>/tutor` | Part two, the tutor's own session screen |
| `/beta/learn/academy/<course>/checkpoint?unit=<unit>`, `/review`, `/final` | Paths sessions in the same player |
| `/beta/learn/academy/record/<id>` | The record of a completed course |
| `POST /api/beta/academy/enrollment` `{ courseId }` | Enroll; 201 the first time, 200 after |
| `DELETE /api/beta/academy/enrollment?courseId=` | Start the course over |
| `POST /api/beta/academy/milestones` `{ courseId }` | Record reached milestones; `{ added, recordId }` |

A lesson's questions use `POST /api/beta/paths/session` and `/answer`, its
close reading `POST /api/beta/tutor/sessions` and `/turn`, and its memory
verses `POST /api/beta/memory/cards`. Every page calls `requireBetaPage()` and
every route `requireBetaApi()`; anyone off `BETA_USER_IDS` gets the ordinary
404, and a founder who is not enrolled is sent to the course page.

## AI and spend

Academy calls no model. The only AI in a course is the tutor's, through the
tutor's own route (consent sheet on the client, the included-AI meter on the
server, surface `beta-tutor`), and only when the founder starts or answers a
close reading. No backfill, no pre-generation, no scheduled job.

## Taking a course together (the Groups hook)

Not built, because SureWord Groups (LC-17656) is not live: it reached `main`
and was reverted in `cf2f4eef` while the production build is made to fit
Vercel's builder (LC-17693). An implementation was written during LC-17660
and exercised end to end on a local build of the Groups tree, but never
reviewed or shipped; it is attached to that issue as `cohort-on-groups.patch`. When Groups returns, a group takes a course together
like this, with nothing new in the engine and no field on Academy's `course`
item:

- **Through Study Rooms, like every Together product.** A group is reached
  only with Rooms' `openModuleRoom(userId, groupId, GROUP_PURPOSE, "academy")`,
  as the caller, so members, roles, leaving and account deletion are Rooms'
  own.
- **A leader starts it.** The group's owner or leader adds one `academy`
  `cohort` post to the group's room (`{ courseId, startedBy, startedAt }`,
  `startedBy` a room member id, never an account id) and can remove it, which
  removes everything shared under it. Enrolling stays each member's own act.
- **Each member chooses to share.** An enrolled member adds one `progress`
  post under the cohort holding only lessons complete out of the total, units
  finished and the date the course was completed, rewritten whenever their
  milestones are recorded (`syncMilestones`). Never answers, scores, close
  readings, memory cards or reflections, by the privacy rules in
  [expansion.md](expansion.md); reading a stored post keeps only those fields.
- **Taking it back.** Stopping sharing removes the member's post; starting the
  course over (`leave`) removes it in every group; leaving or being removed
  from the group takes it with Rooms' own rule.

## Proof

See the LC-17660 closeout on Linear.
