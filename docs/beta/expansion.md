# SureWord's six products, inside SureWord Beta (LC-17639)

**The ask (Jay, LC-17639, 2026-10-26).** "We're currently working on a SureWord
founders-only suite (web version for now) that is more like a sandbox
playground, that eventually we'll roll out certain features to the masses. And
can also have a toggle, so founders can switch between the regular version and
the founders version. Also, can you brainstorm and build these out within the
founders version too?" The six are the spin-off directions in that issue:
**Family, Pastor, Groups, Churches, Kids and Academy**. The issue's own
recommendation is the rule this file follows: "one SureWord app, with multiple
experiences built into it. Not six separate apps", where "private
conversations and prayer journals would remain private unless explicitly
shared."

This file is the brainstorm and the brief. Each product is built by its own run
(the issues are in "Build order" below), and each of those runs reads this file
first, then the module contract in [README.md](README.md).

## One app, six experiences

A product here is not an app and not a separate data silo. It is a package of
tools around one kind of person or relationship (a household, a small group, a
church, a pastor, a child, a student), built from the same study foundations
every other beta module uses. A founder moves between them without leaving
SureWord, and whatever they study in one shows up in the others through the
passages it touches.

**Where they live.** Jay's issue sketches six areas. The beta already had five
destinations from LC-17631's concept board; LC-17639 adds the missing one.

| Jay's area | Beta destination | What it holds |
|---|---|---|
| My Walk | Home (`/beta`) | Today, prayer, reflections, Habits & Reflection |
| Bible | Bible | Reading, cross-references, Atlas & Timeline |
| AI Companion | Study | Ask, Study Projects, the tutor, **SureWord Pastor** |
| Learn | Learn | Paths, Scripture Memory, **SureWord Academy** |
| Family & Groups | **Together** (new) | **SureWord Family, Kids, Groups and Churches** |
| Library | Library | Notes, the Knowledge Vault, the study graph |

"Together" is the tab label because "Family & Groups" does not fit a phone tab
bar of six, and the tab also holds Churches. Six tabs fit at 375px (each tab
gets 61px and the longest label, "Together", measures 46px) and at 320px.

**The toggle.** Founders switch between regular SureWord and the beta with one
two-way switch, **SureWord | Beta** (`src/components/beta/BetaVersionSwitch.tsx`).
In regular SureWord it sits under "Version" at the bottom of the settings menu
on Today, Bible, Study, Connections and Notes, and only founders see it (the
menu asks `GET /api/beta/access`). Inside the beta it sits at the foot of the
desktop rail and in the phone header. The version you are in is marked and is
not a link; the other one takes you there (regular SureWord opens on Today).

## Everything connects: one passage across six products

The issue's example is someone studying James. Every object a product saves
carries its passage keys (`refs`, James 1:19 is `59.1.19`), so the same week
looks like this across the app:

1. **Bible and Study.** The founder reads James 1 and asks why "the wrath of
   man worketh not the righteousness of God".
2. **Home.** They save a private reflection on anger (Habits & Reflection).
3. **Learn.** James 1:19-20 goes into Scripture Memory.
4. **Family.** The family devotion that evening is James 1:19-20, explained for
   a four-year-old ("God gave us two ears and one mouth"), a nine-year-old and
   the adults. The family memory verse that week is the same one.
5. **Kids.** Their child plays the verse's memory game in Kids.
6. **Groups.** Tuesday's small group discusses James 1 with the questions the
   leader prepared, and the prayer circle carries a request about a hard
   conversation at work.
7. **Pastor.** The pastor's series on James has this week's outline, every
   point tied to its verses, and a follow-up study guide.
8. **Churches.** The church receives that follow-up as Sunday's study journey.
9. **Academy.** The New Testament Survey course reaches James, and its lesson
   uses the same tutor and memory tools.
10. **Library.** Weeks later, the Knowledge Vault answers "what have I studied
    about anger?" with the reflection, the verse, the group notes the founder
    wrote, and the sermon outline, and never with anyone else's private items.

## Build on these, never beside them

Every product reuses a foundation instead of building its own. If a foundation
lacks something, extend it backwards-compatibly and say so in the closeout.

| Need | Use | Owner |
|---|---|---|
| Members, invites, a shared space | Study Rooms, with a room per family, group or church | LC-17647 |
| A person's own objects | The study store `BetaItem` / `BetaLink` (`src/lib/beta/store.ts`) | LC-17631 |
| A workspace for one study | Study Projects | LC-17642 |
| A course and its lessons | Learning Paths | LC-17648 |
| Guided questioning | Socratic Tutor | LC-17650 |
| Memorizing verses | Scripture Memory, on Learn a verse (`VerseMemory`) | LC-17651 |
| Checking quotations | Scripture Check | LC-17649 |
| Personal prayer requests | Prayer requests (`UserMemory`, category `prayer`) | shipped |
| Reading a chapter aloud | The audio Bible (chapter MP3 plus verse offsets) | shipped |
| Quizzes whose answer is a verse | Quiz me (`QuizBank`) | shipped |
| A person's church | My church (`UserChurch`) and Sermon studies (`SermonStudy`) | shipped |
| Reading plans | `ReadingPlan` | shipped |

**One child-profile shape.** A child is a `BetaItem` with module `kids` and
kind `child` on a parent's account: a first name or nickname and an age band
(3-5, 6-8, 9-12), nothing else. Kids creates them, and Family and anything later
read them. No other module makes its own child record.

## Private by default, shared on purpose

These rules hold for all six products, and each run proves them with two
founder stand-ins:

- A person's chats, notes, highlights, memories, prayer requests, reflections
  and reading history are private. Nothing personal appears in a family, group
  or church because of membership alone.
- Sharing is an explicit act on one item. It puts a copy (or a pointer the
  sharer can withdraw) into the shared space, and withdrawing it removes it
  there.
- Leaders, pastors and parents of adults see only what members chose to share,
  such as "started this journey". Parents see their own children's progress.
- Account deletion removes everything a person owns in every product
  (`ACCOUNT_DATA_MODELS`, `src/lib/account-deletion.ts`).

**Children, strictly.** Children never get an account and never chat freely
with the assistant. Nothing about a child goes to any model, not even a name;
content is pitched by age band only. No free-form text from a child is stored.
Kids has no links out and no way out without a parent's check. Deleting a
child's profile deletes everything about that child.

**Scripture first, everywhere.** Every product holds to SureWord's mission
(`CLAUDE.md`, Mission). Quotations come from the bundled KJV, never the model's
memory; interpretation, illustration and application are labelled as such; and
anything written for children retells only what the passage says.

## The six products

Priorities follow the issue's own reasoning. Groups and Family come first
because they bring new people into SureWord ("one user could introduce SureWord
to an entire small group"; "family accounts naturally support multiple users").
Churches comes last because it needs Groups and is the closest to software
churches already run.

### SureWord Groups (Together, P1, LC-17656)

**For** a small group or Bible class and the person who leads it. **The
promise:** the group's study, discussion and prayer live in one place, and one
member can bring the whole group in.

**First build:** start a group on Study Rooms and invite members by link; a
group reading plan with each week's passage and where each member is;
discussion around questions the leader prepares with SureWord's help; a guided
session the leader runs (read, observe, discuss, pray); a prayer circle where
requests are marked prayed for and answered.

**Not yet:** video calls, chat outside a passage's discussion, public groups or
discovery. **Model (issue):** per-group or church-sponsored access.

### SureWord Family (Together, P1, LC-17658)

**For** parents leading their household in the Word. **The promise:** one
passage a day the whole table can understand, a verse to learn together, and a
family prayer list.

**First build:** a family on Study Rooms with both parents; children added from
Kids' profiles; the day's family devotion explained at four levels (3-5, 6-8,
9-12, teens and adults), generated only when a parent asks and kept for the
day; a weekly family memory verse on Learn a verse; a family prayer list;
parenting guidance from Scripture.

**Not yet:** chore charts, calendars, screen-time controls. **Model (issue):**
a family subscription.

### SureWord Kids (Together, P2, LC-17657)

**For** children of 3 to 12, on a parent's device. **The promise:** a child
meets the Bible's stories in the Bible's own words, safely.

**First build:** child profiles (the one shape above); Kids mode with large
touch targets and a parent-checked exit; at least 12 Bible adventures, each a
KJV passage read aloud by the audio Bible with a retelling for each age band
beside it; questions and a quiz whose answer is always in the verse; a verse to
learn with a memory game; a star per adventure.

The retellings are written once, checked against the passage line by line, and
committed as data, so there is no per-child generation at all. **Not yet:**
illustrations and animated scenes (image generation is a spend decision), any
chat, any account for a child. **Model (issue):** a family bundle or a
standalone subscription.

### SureWord Pastor (Study, P2, LC-17659)

**For** pastors and Bible teachers preparing to preach or teach. **The
promise:** prepare from the text out, with the context, the original languages
and the cross-references at hand, and turn the sermon into something the
congregation can keep studying.

**First build:** a sermon is a Study Project of its own kind, grouped into
series; passage research from SureWord's own data (context, cross-references,
Hebrew and Greek, passages on the theme); an outline whose points are tied to
their verses; a series planner; follow-up material (a study guide and
discussion questions) saved as a Note; the manuscript checked by Scripture
Check.

**Not yet:** a commentary library (licensing), slides, manuscript teleprompting.
**Model (issue):** a professional subscription. Logos is the incumbent; the
difference SureWord can own is the path from preparation to a congregation's
follow-up study.

### SureWord Academy (Learn, P2, LC-17660)

**For** believers who want to be taught the whole Bible and its doctrine in
order, not just answered. **The promise:** courses with a beginning and an end,
in which you retain what you learn.

**First build:** courses as deeper Learning Paths (units and lessons in Paths'
own shapes); at least three courses (Old Testament Survey, New Testament
Survey, and The Doctrines of the Faith or How to Study the Bible); every lesson
with a KJV reading, teaching, a tutor checkpoint, a quiz and memory verses;
milestones and a record of completed courses; a group taking a course together
once Groups is live.

**Not yet:** certificates with any outside standing, paid or licensed content,
instructor-led classes. **Model (issue):** course subscriptions, church
licenses and premium content.

### SureWord Churches (Together, P3, LC-17661)

**For** a church's pastors and its members. **The promise:** the pastor's
teaching and the church's small groups meet the member where they study,
without the church seeing anyone's private walk.

**First build:** a church on Study Rooms, started from My church, with pastors
and group leaders; study journeys a pastor assigns to the church or a group
(a path or course, a reading plan, or a Pastor follow-up study); Sunday
follow-up shared to the church; the church's small groups gathered under it.

**Deliberately not:** scheduling, attendance, giving and donations. Planning
Center and its peers own those, and the issue says not to compete there.
**Model (issue):** church licensing.

## Build order

| Product | Issue | Lane | Runs after |
|---|---|---|---|
| Groups | LC-17656 | `ai-queue-8` | Study Rooms (LC-17647) |
| Family | LC-17658 | `ai-queue-8` | Groups; Kids for child profiles |
| Churches | LC-17661 | `ai-queue-8` | Family |
| Kids | LC-17657 | `ai-queue` | nothing (it uses what SureWord already ships) |
| Pastor | LC-17659 | `ai-queue-3` | Study Projects (LC-17642), Sermon to Study, Audio Overviews |
| Academy | LC-17660 | `ai-queue-9` | Learning Paths (LC-17648); Tutor and Memory |

Each run checks its dependencies on SureWord `main` before it starts and stops
with a dependency halt rather than build a substitute.

## Later, not now

- **Packages and pricing.** The issue imagines these as "optional modes or
  premium packages within the same app". Which ones become paid, and how they
  map onto SureWord Pro, is a founders' decision. The beta builds no paywall,
  and everything in it is open to the founders.
- **Other people.** The beta admits only `BETA_USER_IDS`, so a family, group or
  church in the beta can hold only founders and testers on that list. Adding a
  tester is appending their Clerk id.
- **Phones.** Web only, as for the whole beta (`docs/PARITY.md`).
