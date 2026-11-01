# SureWord Family (`family`, Together)

**LC-17658**, one of the six SureWord products in [expansion.md](expansion.md),
built to the contract in [README.md](README.md). Status `building` at
`/beta/together/family` for `BETA_USER_IDS` only. A family is a Study Room
([rooms.md](rooms.md)) of purpose `family`, extended the way SureWord Groups
([groups.md](groups.md)) extends Rooms: the same members, invite link and
tables, never a second membership system. Its children are SureWord Kids
profiles ([kids.md](kids.md)), never a child record of Family's own.

## What it does (Part 1)

- **Start a family.** Anyone in the beta starts a family (a name, and the name
  they go by there, such as "Dad") and owns it. Every account in a family is one
  of its parents; Family adds no role to Rooms (Rooms' owner and member are
  enough: the owner invites and removes, a parent leaves).
- **Invite the other parent.** The owner makes Study Rooms' own invite link
  (12 random bytes, 16 base64url characters) from "Invite", opening
  `/beta/together/family/join/<slug>`, Rooms' join page for a family. "Make a
  new link" and "Turn the link off" work exactly as in Rooms. A family's link is
  the ordinary 404 at Study Rooms' and Groups' join routes, and theirs are 404s
  here.
- **Add your children.** A parent taps "Add a child" and chooses one of their
  own SureWord Kids profiles; the family lists each child by first name and age
  band, youngest first, with who added them. A parent with no profile yet is
  sent to SureWord Kids to make one. The parent who added a child, or the
  owner, can take them out of the family; the profile and its stars stay in
  Kids. A parent who leaves, or is removed, takes the children they added with
  them, because those profiles are on their account.
- **Settings.** The owner renames or archives the family through Rooms' own
  settings panel (archiving turns the invite link off).

**Next** (filed as follow-ups on LC-17658): the family devotion for the day at
four levels, the family memory verse each week, the family prayer list, and
parenting guidance from Scripture.

## Privacy

The rules of [expansion.md](expansion.md) hold, and `tests/beta-family.test.mjs`
pins them:

- `src/lib/beta/family/family.ts` reads rooms only through Study Rooms
  (`getRoomView`, `openModuleRoom` with purpose `family`), and never imports
  Prisma, so every read starts from the caller's membership and a family they
  are not in is the ordinary 404.
- **A child is a link, not a copy.** Adding a child writes one room post under
  module `family`, kind `child`, whose `data` is only `{ childId }`, written as
  the parent who added it. The family view reads the name and age band from
  that profile on that parent's account (`getChild(authorId, childId)`), every
  time: rename the child in Kids and both parents see the new name; delete the
  profile and the child is no longer in the family. A parent can add only their
  own profiles: another parent's profile id is refused, like one that does not
  exist.
- What one parent sees of a child goes through the allowlist `childView` in
  `family-rules.ts`: `{ linkId, name, ageBand, ageLabel, addedBy, isYours,
  canRemove }`. No view carries an account id, a Kids profile id, or a child's
  stars and verses. Parents are Rooms' own `MemberView`.
- Each parent's own notes, prayer list and conversations with SureWord are
  never read by Family. Nothing about a child reaches a model.

## AI, Scripture and spend

Part 1 makes no model call and quotes no Scripture. No backfill, no
pre-generation, no job.

## Data

No table of its own and no migration. A family is a `BetaRoom` with `purpose`
`family`; its parents are `BetaRoomMember` rows (role `owner` or `member`);
its children are `BetaRoomPost` rows:

| Kind | Under | Written as | Holds (`data`) |
|---|---|---|---|
| `child` | the family | the parent who added the child | `childId` (that parent's `kids`/`child` `BetaItem`) |

A link whose profile was deleted in Kids is skipped by the view, but its row
stays and still counts toward the family's 12 children until the next Family
slice prunes such links (a known Part 1 limitation, filed on LC-17658). Leaving,
removal, archiving and account deletion are Study Rooms' (and Kids') own.

| API | Does |
|---|---|
| `GET /api/beta/family` | the families you are a parent in |
| `POST /api/beta/family` `{ name, displayName }` | starts one (you own it) |
| `GET` / `PATCH /api/beta/family/<id>` `{ name?, description?, archived? }` | the family; the owner renames or archives it |
| `POST` / `DELETE /api/beta/family/<id>/invite` | the owner's invite link, on or off |
| `DELETE /api/beta/family/<id>/members/<memberId>` | the owner removes a parent, or you leave |
| `POST /api/beta/family/<id>/children` `{ childId }` | adds one of your Kids profiles |
| `DELETE /api/beta/family/<id>/children/<linkId>` | takes a child out of the family |
| `GET` / `POST /api/beta/family/join/<slug>` `{ displayName }` | the invite's preview, and joining |

Every route is founders-only (`requireBetaApi`); the pages call
`requireBetaPage()`.

## Proof

Proven on a local production build against a throwaway Neon branch, with
both founder stand-ins as the two parents ("Dad" at 1280 desktop, "Mum" at
375px touch), one Kids profile on each account, light and dark on each
viewport, and the off-list account getting the ordinary 404 on every page and
every API route. The run, its screenshots and its database rows are on
LC-17658.
