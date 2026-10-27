# Study Rooms (`rooms`, Study)

**LC-17647**, built to the contract in [README.md](README.md). Live at
`/beta/study/rooms` for `BETA_USER_IDS` only. Inspired by Google Docs and
shared workspaces; the foundation SureWord Groups (LC-17656), Family and
Churches extend rather than duplicate ([expansion.md](expansion.md)).

## What it does

A room is for a family, a small group or a class studying together:

- **Create and invite.** Anyone in the beta creates a room (a name, an
  optional line on what it is studying, and the name they go by there) and
  owns it. The owner turns on an invite link, `/beta/study/rooms/join/<slug>`.
  The slug is the capability, minted like a shared answer's id (12 random
  bytes, 16 base64url characters): anyone on `BETA_USER_IDS` who opens it sees
  the room's name, its owner's room name and its size, chooses their own name
  and joins. "Make a new link" replaces the slug, so the old link stops
  working; "Turn the link off" clears it. People already in stay in.
- **Passages.** A member shares a passage inside one chapter (`Romans 5`,
  `Rom 5:1-11`, `John 3:16`), with an optional line on why. The room shows the
  verses from the bundled KJV every time it renders (up to 40, then "Continue
  in the Bible"), never text a person or a model typed, and opens the reader at
  the passage. Cross-chapter ranges, unknown books and chapters past the end
  are refused with a plain message.
- **Questions and discussion.** A member asks a question (optionally about a
  passage); anyone replies under it, one level deep, newest questions first
  and each conversation reading down.
- **Shared notes.** A member writes a note for the room, or shares a **copy**
  of one of their own notes: the picker lists only their own notes (the
  ordinary notes API), nothing is shared until they confirm, and the copy is
  marked "Shared from Jay's notes". Later edits to the note never reach the
  room, and the author can remove the copy at any time.
- **Reading together.** The owner picks one of the reading-plan presets (The
  Gospels in 30 days, Psalms & Proverbs in 31 days, the New Testament in 90
  days, the Whole Bible in a year). The room is on the same day for everyone,
  counted from when the plan was chosen, and shows today's chapters and focus.
  A member who taps **Follow this plan** gets it as their own `ReadingPlan`
  through `startPlan`, backdated to the room's day 1, so the Bible reader fills
  it in exactly as it does any plan. If they are partway through another plan
  of their own, the room asks first ("Replace your reading plan?") and replaces
  it only with that plan's id confirmed. "Where everyone is" shows each
  follower's current day and how many days they have read; members who do not
  follow show "Not following". "Stop sharing my progress" unlinks; the plan
  stays theirs. A member who comes back to a room whose plan they are still
  reading (same plan, same day 1) is linked to it again, never asked to
  replace it.
- **Owner controls.** Rename and describe, choose or change the plan (a new
  plan starts at day 1 for everyone and unlinks followers; their own plans are
  left as they are), remove a member, turn the link off or replace it, archive
  and restore. An archived room is read-only: no posts, no joins, no invite
  link; everyone can still read it, and leaving or removing your own posts
  still works. The owner cannot leave (they archive instead).
- **Leaving and removal.** A member leaves from Group; the owner removes a
  member. Either way that member's posts in the room, and the replies others
  wrote under them, are deleted in the same transaction, and both
  confirmations say so. Removal also replaces a live invite link, because the
  removed member holds it; the owner shares the new one with anyone still to
  join. (Keeping a thread when its first post's author leaves, with the post
  blanked, is a choice SureWord Groups can make; rooms errs toward taking a
  person's words with them.)
- **Who is who.** Room names are chosen, not verified, so the owner's posts and
  replies carry an "Owner" mark.

Polling: an open, visible room refreshes every 20 seconds and on focus, so
what the others add shows up without a reload; a refresh that started before
your own change never overwrites it. Times and dates render in the reader's
own clock after the page loads. No AI runs anywhere in rooms, so they cost
nothing per use.

**Scale note for Groups and Churches.** Every view reads each follower's plan
through `getActivePlan` (a few queries over their reading log) and returns the
whole room. That is nothing for a family or a small group; a church-sized room
wants progress cached or read less often, and the posts paged.

## Privacy: what a room can and cannot see

Each person keeps a private study of their own. The server enforces it, and
`tests/beta-rooms.test.mjs` proves it:

- A room holds only what its members typed into it or chose to share into it.
  `src/lib/beta/rooms/rooms.ts` touches `BetaRoom`, `BetaRoomMember`,
  `BetaRoomPost` and exactly one read of `Note`, scoped to the caller's own id
  and passed through `snapshotSharedNote`, which refuses anyone else's note.
  It never reads conversations, messages, memories (prayers) or highlights;
  the test pins that list. The one read beyond the room is a following
  member's own reading plan, through `getActivePlan` (which reads their reading
  log to count days), and only for members who chose to follow.
- What one member sees of another goes through allowlists in
  `src/lib/beta/rooms/rooms-rules.ts`: a member is `{ id, displayName, role,
  isYou, joinedAt, plan, action }` (never their Clerk id or email), a post is
  its author's room name and its own text, and a follower's progress is five
  numbers (`following, currentDay, completedCount, dayCount, percent`), read
  only while their active plan is still the one they started from the room and
  the room is still reading that preset.
  Their days, chapters, streak and history never leave the server.
- Only the owner's view carries the invite slug.

## Data

Three tables of their own (the shared `BetaItem` store is owner-scoped by
design, and a room is shared), in `prisma/schema.prisma` under
`// Beta module: rooms`, migration `20261027020000_beta_rooms` (rooms
statements only, `lock_timeout` 5 s):

| Model | Holds | Goes away when |
|---|---|---|
| `BetaRoom` | `purpose` (`study`, `family`, `group`, `church`), name, description, `inviteToken` (unique, null while off), `planPresetKey` + `planStartDate`, `archivedAt` | its owner's account is deleted (everything in it goes too) |
| `BetaRoomMember` | `roomId`, `userId`, `role` (`owner`/`member`), `displayName`, `planId` (the member's own `ReadingPlan` while following; not a relation) | the member leaves, is removed, or deletes their account |
| `BetaRoomPost` | `module` (`rooms` for these kinds), `kind` (`passage`/`question`/`note`/`reply`), `parentId`, `title`, `body`, `data` (`passage`, `sharedNote`) | its author leaves, is removed or deletes their account, or its parent goes |

All three are in `ACCOUNT_DATA_MODELS` and the Account deletion table in
`docs/FEATURES.md`. Limits: 30 members a room, 20 open rooms an owner, 1,000
posts a room, questions 600 characters, replies 2,000, notes 8,000 (a longer
shared note is clipped with an ellipsis).

## Extending Rooms (Family, Groups, Churches)

Rooms is the one membership layer for Together's products
([expansion.md](expansion.md)); build on it, never beside it:

- **Purpose.** Every room has a `purpose`: `study` (made and listed here),
  `family`, `group` or `church`. `createRoom(userId, input, purpose)` and
  `listRooms(userId, purpose)` take it, so each product opens and lists its
  own rooms through the same tables, invites and gate.
- **Shared objects.** A post carries the `module` that wrote it. Study Rooms
  writes and shows only `module = "rooms"`; a family prayer list or a church's
  assigned journey writes its own kinds under its own slug, scoped by
  membership exactly as these are, and leaving or removal already deletes a
  member's posts of every module. (A shared family prayer is one its author
  posts into the room on purpose; a person's own prayer requests stay private
  as they are here.)
- **Roles.** `role` is a plain string, `owner` or `member` today. A product
  that needs a leader or a parent adds the value and its rules; until then
  `asRole` treats an unknown role as a member, so nothing gains rights by
  accident.
- **A room inside a room** (a small group in a church) is not built; a
  nullable parent column added by the product that needs it fits without
  touching anything here.

The one change outside the module: `startPlan` (`src/lib/reading-plans.ts`)
takes an optional `startDate`, so a plan read together starts on the room's
day 1.

## Files

- Pages: `src/app/beta/study/rooms/page.tsx` (your rooms and a new one),
  `[id]/page.tsx` (a room, 404 unless you are in it), `join/[token]/page.tsx`.
- API (`src/app/api/beta/rooms/`): `GET`/`POST /` (list, create);
  `GET`/`PATCH /:id`; `POST`/`DELETE /:id/invite`; `POST /:id/posts`;
  `DELETE /:id/posts/:postId`; `DELETE /:id/members/:memberId` (remove or
  leave); `POST`/`DELETE /:id/plan` (follow, stop sharing);
  `GET`/`POST /join/:token`. Every handler starts with `requireBetaApi()`, acts
  only as `gate.userId`, and answers a room you are not in with the beta's
  ordinary 404. Mutations answer with the room as you now see it.
- Logic: `src/lib/beta/rooms/rooms-rules.ts` (pure), `rooms.ts` (server),
  `http.ts` (responses).
- UI: `src/components/beta/rooms/` (`RoomsHome`, `RoomScreen`, `RoomFeed`,
  `RoomPostCard`, `RoomGroupPanel`, `RoomSheets`, `JoinRoom`, `room-ui`,
  `room-client`). Mobile: Passages, Questions, Notes and Group tabs. Desktop:
  the three feeds as tabs beside a Group column (plan, members, your private
  study, room settings).
- Tests: `tests/beta-rooms.test.mjs`.

## Testers

The gate is unchanged: adding a tester is appending their Clerk id to
`BETA_USER_IDS`. An invite link opened by anyone off the list is the ordinary
404, like every other beta page.

## Proof

See LC-17647 for the screenshots and the full run.
