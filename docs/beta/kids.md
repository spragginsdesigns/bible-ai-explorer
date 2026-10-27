# SureWord Kids (LC-17657)

A child-safe space a parent opens on their own device, inside SureWord Beta's
**Together** destination at `/beta/together/kids`. It is the P2 product from
[expansion.md](expansion.md) → SureWord Kids, built on the module contract in
[README.md](README.md). Founders only, web only.

## What it does

- **The parent's page** (`/beta/together/kids`) adds a child with only a first
  name or nickname and an age band (3-5, 6-8 or 9-12), renames them or moves
  them to another band, removes them, shows each child's stars and learned
  verses, and opens Kids mode for one child. Up to 8 profiles.
- **Kids mode** (`/beta/together/kids/play?child=<id>`) fills the screen for
  that child: twelve Bible adventures, each with three steps.
  - **Story.** The KJV passage plays from the audio Bible (the same chapter
    MP3s and verse timings as the reader's Listen, through
    `/api/bible/audio`, nothing generated), with the verse being read
    highlighted. Only the passage plays: each segment starts at its first verse
    and stops at the end of its last, and a passage across chapters (Noah,
    Joseph, Jonah) plays straight through. Beside the text is the retelling for
    the child's age band, each line showing the verse it comes from.
  - **Questions.** Two (3-5), three (6-8) or four (9-12) questions with three or
    four choices. After every choice the child sees the verse that holds the
    answer; a wrong choice is crossed out and they try again. Answering all of
    them earns the adventure's star.
  - **Verse.** A verse (or the exact words of part of one) learned on Learn a
    verse's own ladder (`verseWords` in `src/components/learn/learn.ts`): read
    it, then say it with words hidden (stage 1 for 3-5, up to stage 2 for 6-8,
    stage 3 for 9-12), then Learn's "Tap the next word" (`orderRound`,
    `tapOrderWord`), which 3-5 gets only for verses of 8 words or fewer.
    Finishing marks the verse learned.

## The adventures

`src/lib/beta/kids/adventures.ts`, checked in as data and never generated:

| Adventure | Passage | Verse to learn |
|---|---|---|
| God Makes the World | Genesis 1:1-31; 2:1-3 | Genesis 1:1 |
| Noah and the Ark | Genesis 6:13-22; 7:12-18; 8:8-12; 9:12-16 | Genesis 6:22 |
| Abraham Counts the Stars | Genesis 12:1-4; 15:5-6; 21:1-3 | Genesis 15:6 |
| Joseph and His Brothers | Genesis 37:3-4, 23-28; 41:39-43; 45:3-8 | Genesis 45:5 (part) |
| Moses and the Red Sea | Exodus 14:10-16, 19-31 | Exodus 14:14 |
| David and Goliath | 1 Samuel 17:4-11, 32-50 | 1 Samuel 17:47 (part) |
| Daniel and the Lions | Daniel 6:10-23 | Daniel 6:22 (part) |
| Jonah and the Great Fish | Jonah 1:1-4, 12-17; 2:1, 9-10; 3:1-5, 10 | Jonah 2:9 (part) |
| Jesus Is Born | Luke 2:1-21 | Luke 2:11 |
| Jesus Calms the Storm | Mark 4:35-41 | Mark 4:39 (part) |
| Five Loaves and Two Fishes | John 6:1-14 | John 6:12 (part) |
| Jesus Is Risen | Matthew 28:1-10 | Matthew 28:6 (part) |

**How they were written and checked.** Each retelling sentence names the
verses it retells and says nothing those verses do not say: it may leave
things out and use a simpler word for the same thing ("grave" for sepulchre),
never a new fact or a moral the passage does not state. Words inside quotation
marks are the KJV's own. Every line was read beside its verses before it
shipped, and `tests/beta-kids.test.mjs` holds the mechanical part of that:

- every cited verse is inside the adventure's passage, and lines follow the
  passage's order;
- every name a retelling uses (Goliath, Pharaoh, Jesus) appears in the passage,
  with one recorded exception: Mark 4:35-41 calls Jesus only "he" and "Master",
  so `alsoNamed` records where the chapters around it name him;
- every quiz answer passes Quiz me's own grounding rules (`answerIsGrounded`,
  `distractorContradictsVerse`, `answerStandsOut` in `src/lib/quiz-rules.ts`)
  against the verses it cites, and the choices are placed by Quiz me's
  `arrangeOptions`;
- every verse to learn is found word for word in the bundled KJV.

The passage text shown in Kids is read from the bundled KJV
(`src/lib/bible/kjv.ts`) on the server, never typed into the data.

## Data

There is no table of its own. A child is the shared study store's **one
child-profile shape** (expansion.md), which SureWord Family and anything later
read and never duplicate:

| Field | Value |
|---|---|
| `module` / `kind` | `kids` / `child` |
| `title` | always `Child profile` |
| `body`, `refs`, `topics` | empty |
| `data` | `{ name, ageBand, stars: string[], verses: string[] }` |

The name lives only in `data`, never in the title or body, so nothing that
indexes titles and bodies (the Knowledge Vault) can carry a child's name
anywhere, least of all to a model. Read a child only through
`parseKidsChild` (`src/lib/beta/kids/kids-rules.ts`), which keeps only
adventure ids from the catalog. `stars` and `verses` are adventure ids;
nothing a child does is stored but those ids.

| API | Does |
|---|---|
| `GET /api/beta/kids/children` | the parent's children |
| `POST /api/beta/kids/children` `{ name, ageBand }` | adds one (201); any other field is ignored |
| `PATCH /api/beta/kids/children/<id>` `{ name?, ageBand? }` | renames or moves a band; stars stay |
| `DELETE /api/beta/kids/children/<id>` | removes the profile and all its progress |
| `POST /api/beta/kids/children/<id>/progress` `{ adventure, award: "star" \| "verse" }` | Kids mode's only write |

Every route is founders-only (`requireBetaApi`), and another parent's child id
answers 404 like one that never existed. Account deletion removes the profiles
with the parent's other `BetaItem`s (`onDelete: Cascade`, already in
`ACCOUNT_DATA_MODELS`).

## Child data protection

- **No model, ever.** No file under `src/lib/beta/kids`,
  `src/components/beta/kids`, `src/app/beta/together/kids` or
  `src/app/api/beta/kids` imports the AI, chat, embeddings or analytics code
  (the tests fail if one does). Content is pitched by age band only.
- **Nothing typed by a child.** Kids mode has no input, text area or editable
  element; the only write is an adventure id from the catalog.
- **Not in analytics.** The child is a query parameter, and page views send the
  path without the query (`AnalyticsProvider`). Kids sends no events of its
  own; like every API call in the app, a failed one is reported by the
  app-wide failure observer with its path, which holds only the profile's
  random id, never a name or an age.
- **Deleting is deleting.** A profile holds all of a child's progress, so
  removing it removes everything about that child.

## The way out

Kids mode is a modal `<dialog>` that fills the screen, so the beta's header,
rail and tab bar behind it are inert to touch, mouse and keyboard. It has no
links. Every way out leads to the parent check:

- **Grown-ups** in the corner opens it.
- **Escape** opens it, and a browser that force-closes the dialog reopens it.
- **Back**: the first tap inside Kids adds a history entry (Chrome skips
  entries added without a tap), and going back from it opens the check.
- **A reload** stays in Kids (the child is in the URL). Opening Kids writes a
  lock for the tab (`sessionStorage`), and the parent's page sends anyone who
  reaches it while the lock is set (a back gesture before any tap, a typed
  address) straight back into Kids.
- **What's new** (`WhatsNewPresenter`), whose cards link out, never opens over
  Kids mode.

The check is a sum of two numbers from 51 to 89, written in words ("What is
sixty-four plus fifty-seven?"), whose three-digit answer is typed on a number
pad. A wrong answer brings a new sum; every third wrong answer locks the pad
(30 s, 60 s, 2 min, then 5 min), and the count survives a reload. Passing it
clears the lock and returns to the parent's page. For a full device lock the
parent's page suggests Guided Access (iPhone) or app pinning (Android).

## Proof (LC-17657)

On a production build against a Neon branch of `versemind`, with the dev Clerk
founder stand-ins and the off-list account, at 375px with touch and at 1280, in
light and dark. The run, its screenshots and its database checks are in the
LC-17657 closeout on Linear.
