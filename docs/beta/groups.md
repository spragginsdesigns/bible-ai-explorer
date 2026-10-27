# SureWord Groups (`groups`, Together)

**LC-17656**, one of the six SureWord products in [expansion.md](expansion.md),
built to the contract in [README.md](README.md). Live at
`/beta/together/groups` for `BETA_USER_IDS` only. A group is a Study Room
([rooms.md](rooms.md)) of purpose `group`: the same members, invite link,
reading plan and tables, never a second membership system. SureWord Family and
SureWord Churches extend what is built here.

## What it does

- **Start a group and invite it.** Anyone in the beta starts a group (a name,
  an optional line on what it is studying, and the name they go by there) and
  owns it. The invite link is Study Rooms' own capability (12 random bytes, 16
  base64url characters), opening `/beta/together/groups/join/<slug>`; "Make a
  new link" and "Turn the link off" work exactly as in Rooms. A group's link is
  the ordinary 404 at Study Rooms' join route, and a study room's link is one
  here.
- **Leaders.** The owner leads the group they start and names other leaders
  from the member list ("Make a leader", "Make a member again"). Leaders set
  each week's passage, prepare and add the questions, run the sessions, and can
  remove members (never the owner or another leader). A member leaves from
  Group; removing a member replaces a live invite link, as in Rooms.
- **The reading plan, week by week.** The owner chooses one of the reading-plan
  presets through Study Rooms' own plan panel (`ReadingTogether`), and members
  follow it as their own `ReadingPlan` from the group's day 1. Groups adds the
  plan in weeks of seven days: this week's readings ("Week 2 of 5 · Matthew 22
  to Mark 5"), every week of the plan, and where each member is (their day and
  days read, the five numbers Rooms allows). No second plan engine.
- **Each week's passage.** A leader sets the week's passage: one chapter or
  verses inside it, typed or picked from this plan week's chapters, with
  optional themes ("anger, listening"). Everyone reads it in the bundled KJV,
  with **Listen**, which plays the audio Bible's own recording of exactly those
  verses with the verse being read marked (the player SureWord Kids uses; no
  narration is generated or bought). Earlier weeks fold up below, with their
  discussion and session notes.
- **Discussion around questions a leader prepares with SureWord's help.**
  "Prepare questions" (leaders only, at most three times a week) asks SureWord
  to draft seven to nine questions on the week's passage in three movements,
  Observe, Interpretation and Apply, each tied to its verses, plus a short note
  of background for the leaders labelled "SureWord's interpretation, not
  Scripture". Nothing reaches the group until a leader adds it, as drafted
  ("Prepared with SureWord") or edited first. Leaders can also write their own.
  Each question shows the KJV text of the verses it rests on, and every member
  answers under it.
- **The guided session.** When the group meets, a leader taps "Run the session"
  and walks it step by step: **Read** the passage aloud or together (with
  Listen), **Observe** (the observation questions), **Discuss** (the rest), and
  **Pray** (the open requests in the prayer circle). The leader keeps notes for
  each step, saved to the group on every step; "End the session" keeps them
  with the week for everyone. While it runs, every member sees a "Session in
  progress" bar with the current step (the screen refreshes every 20 seconds).
  One session runs in a group at a time.
- **The prayer circle.** A member shares a request (typed, with an optional
  verse they are standing on) or a **copy** of one from their own prayer list:
  the picker lists only their own open prayer requests through the ordinary
  memories API, nothing is shared until they confirm, and the copy is marked
  "Shared from Ruth's prayer list". The others mark "I prayed" (one mark each,
  undoable), the asker marks it answered with an optional note, or reopens it.
  Open requests come first; answered ones gather under Answered.

## Privacy

The rules of [expansion.md](expansion.md) hold, and `tests/beta-groups.test.mjs`
pins them:

- A group holds only what its members typed into it or chose to share into it.
  `src/lib/beta/groups/groups.ts` reads rooms only through Study Rooms
  (`getRoomView`, `openModuleRoom`), so every read starts from the caller's
  membership and a group they are not in is the ordinary 404. The only private
  data it reads is the caller's own prayer request being shared
  (`prisma.userMemory.findFirst` by id, the caller's id and category `prayer`)
  and the caller's own AI consent.
- What one member sees of another goes through allowlists in
  `groups-rules.ts`: a person is `{ memberId, displayName, role, isYou }`, and
  no view carries an account id, a store item id or another member's private
  study. Leaders' drafts and the weekly preparation count are in leaders' views
  only.
- **Your own copy.** A member's own words in a group (a question, an answer,
  a session's notes, a prayer request) are also kept in their own study store
  as a `groups` item with the same `refs` and `topics`, which is how the
  Knowledge Vault and the Living Study Graph find them, and never anyone
  else's. Removing your post removes your copy; leaving or being removed takes
  your words out of the group (Rooms' rule) but leaves the copy in your study;
  deleting your account deletes both. The Vault's link to a copy,
  `/beta/together/groups?item=<id>`, opens the group while you are in it, and
  otherwise shows the copy as yours.

## AI, Scripture and spend

- The only model call in Groups is "Prepare questions"
  (`src/lib/beta/groups/groups-prepare.ts`), made only when a leader taps it,
  at most three times a week per group week, after AI consent. It uses the
  house model through `resolveModel`, with SureWord's system prompt first. No
  backfill, no pre-generation, no job.
- The model is given the passage from the bundled KJV and told never to quote
  Scripture from memory. `checkPreparedDraft` then drops any question whose
  verses are outside the passage or whose quotation is not word for word in the
  passage's KJV text, and drops the leaders' note when it quotes anything not
  in the passage. The note's background (who wrote the book, to whom) comes
  from other verses, so the prompt (v2) has it paraphrase and cite verse
  numbers, never quote; v1 lost the note that way on one passage in three. The verse
  text shown beside every question is read from the bundle, never stored or
  typed.
- Interpretation is labelled: interpretation questions carry the
  "Interpretation" chip, and the leaders' note is headed "SureWord's
  interpretation, not Scripture".

## Data

No table of its own and no migration. A group is a `BetaRoom` with `purpose`
`group`; its members are `BetaRoomMember` rows (role `owner`, `leader` or
`member`); everything in it is a `BetaRoomPost` under `module` `groups`:

| Kind | Under | Written as | Holds (`data`) |
|---|---|---|---|
| `week` | the group | the group's owner (the week is the group's, so it stays when a leader leaves) | `passage`, `refs`, `topics`, `planWeek`, `setBy` (a member id), `prep` (SureWord's drafts), `prepared` |
| `question` | a week | the leader who added it | `refs`, `topics`, `type`, `verses`, `prepared`, `mirrorId` |
| `reply` | a question | its author | `refs`, `topics`, `mirrorId` |
| `session` | a week | the leader running it | `refs`, `topics`, `step`, `notes` by step, `endedAt`, `mirrorId` |
| `prayer` | the group | its asker | `refs`, `topics`, `passage?`, `fromPrivateList`, `answeredAt`, `answer`, `mirrorId` |
| `prayed` | a prayer | the member who prayed | `refs`, `topics` |

The copies in a member's own study are `BetaItem`s with module `groups`, kinds
`question`, `reply`, `session` and `prayer`, and `data` `{ groupId, postId,
group }`. Account deletion takes all of it through the existing cascades
(`BetaRoom`, `BetaRoomMember`, `BetaRoomPost`, `BetaItem` are already in
`ACCOUNT_DATA_MODELS`). Limits: 15 questions a week, answers 2,000 characters,
prayer requests 1,000, session notes 4,000 a step, and Rooms' own (30 members,
1,000 posts a room).

## What Groups added to Study Rooms

Backwards compatible; Study Rooms behaves exactly as before, and its tests are
unchanged:

- **Purpose scoping.** Every Study Rooms function takes an optional `purpose`
  (default `study`), and membership and invite lookups filter by it, so Study
  Rooms' routes see only study rooms and each Together product sees only its
  own. `ROOM_PURPOSE_PATHS` and `roomInvitePath(token, purpose)` say where each
  purpose lives.
- **A leader role.** `leader` joins `owner` and `member`: a leader may remove
  members (`memberAction`), and `setMemberRole` lets the owner name or unname
  leaders. Study Rooms never creates one.
- **Other modules' shared objects.** `openModuleRoom(userId, roomId, purpose,
  module)` opens a room for one module: the caller's membership, the members
  as the server sees them, and that module's own posts (list, find, create,
  update, remove), scoped to the room and the module's slug, never Study Rooms'
  own kinds. Family and Churches keep their shared objects the same way.
- `parsePassage` and `passageView` are exported, and Study Rooms' invite sheet,
  join page, plan panel and settings take a `purpose` for their paths and copy.

## Files

- Pages: `src/app/beta/together/groups/page.tsx` (your groups and a new one),
  `[id]/page.tsx` (a group, 404 unless you are in it), `join/[token]/page.tsx`
  (Study Rooms' `JoinRoom` for a group).
- API (`src/app/api/beta/groups/`): `GET`/`POST /` (list, start);
  `GET`/`PATCH /:id`; `POST`/`DELETE /:id/invite`; `PATCH`/`DELETE
  /:id/members/:memberId` (role; remove or leave); `POST`/`DELETE /:id/plan`;
  `POST /:id/posts` (week, question, reply, session, prayer);
  `PATCH`/`DELETE /:id/posts/:postId` (a session's steps and notes, a prayer's
  prayed and answered; remove); `POST /:id/posts/:weekId/prepare`;
  `GET`/`POST /join/:token`. Every handler starts with `requireBetaApi()`, acts
  only as `gate.userId`, and answers a group you are not in with the beta's
  ordinary 404. Mutations answer with the group as you now see it.
- Logic: `src/lib/beta/groups/groups-rules.ts` (pure), `groups.ts` (server),
  `groups-prepare.ts` (the one AI call), `http.ts`.
- UI: `src/components/beta/groups/` (`GroupsHome`, `GroupScreen`,
  `GroupWeeks`, `GroupSession`, `PrayerCircle`, `GroupPanel`, `GroupSheets`,
  `group-ui`). Phone: This week, Prayer and Group tabs. Desktop: This week and
  Prayer beside a Group column (the plan by week, members and leaders, your
  private study, group settings).
- Tests: `tests/beta-groups.test.mjs`.

## Not yet

Video calls, chat outside a passage's discussion, public groups or discovery
([expansion.md](expansion.md)), and a group inside a church (Churches adds the
parent room it needs).

## Proof

See LC-17656 for the screenshots and the full run.
