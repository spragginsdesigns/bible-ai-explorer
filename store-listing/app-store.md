# App Store listing copy (iOS, PRD H3)

The exact text for SureWord's App Store page. Start at
[`store-listing/README.md`](README.md); the Play twin is
[`play-store.md`](play-store.md).

> **PENDING (2026-10-09): App Store Connect is behind this file.** The name,
> subtitle, promotional text, description and keywords below were rewritten on 2026-10-09 but
> could not be entered: 1.13.0 was Waiting for Review, which locks them, and
> Austin chose not to pull it. As soon as that review finishes (approved or
> rejected), on the Mac:
> 1. Work through "Verify before submitting" under the description and cut
>    any line whose feature is not verified on the build being submitted.
> 2. `uv run -q --with pyjwt --with cryptography --with requests python macos/scripts/asc.py listing apply com.spragginsdesigns.sureword store-listing/app-store.md`
> 3. `... asc.py listing check ...` must print "matches"; then delete this
>    block. TickTick task 6ac950948f089f376a25a421 tracks it, and
>    `macos/release-ios.sh` reports the drift on every run until it is done.

Status: first entered in App Store Connect on 2026-10-07 (version 1.10.0,
en-US) through the API. This file is the source of truth for the listing;
`asc.py listing check` compares it with App Store Connect. Copy follows the Mission in `CLAUDE.md`: SureWord
speaks as a believer who holds the King James Bible as the inerrant Word of
God, without claiming the AI is infallible.

Rules for this file:

- Claim only what the iPhone/iPad build does at submission. Source of truth is
  the iOS column of `docs/PARITY.md` plus `docs/ios/PROGRESS.md`.
- Lines that depend on an in-flight lane carry an HTML comment naming the PRD
  row. Before submitting, delete the comment if the row is `verified`, or
  delete the line if it is not.
- No price and no competitor names. SureWord Pro is a StoreKit subscription
  (PRD F2), so the description carries Apple's auto-renewal disclosure and the
  Terms of Use link (guideline 3.1.2).
- Character counts below were measured with `wc -m` on the exact text.

## Name and subtitle

| Field | Text | Chars (limit) |
|---|---|---|
| Name | `SureWord: Personal Bible Guide` | 30 (30) |
| Subtitle | `Walk with the Word in the KJV` | 29 (30) |

Chosen by Austin on 2026-10-09 to replace `SureWord` / `KJV Bible study, made
personal`. The app does more than study (Bible reader, Pick Up Your Cross,
Listen, reading plans, word study, prayer), so the name says "guide" and the
title keeps "Bible" for search. "Guide" rather than "Teacher" on purpose:
Scripture names the Holy Spirit as the believer's teacher (John 14:26,
1 John 2:27). Apple only allows a name change while a version is in Prepare
for Submission, so this goes live with the next iOS submission; the name under
the icon on the device stays `SureWord`. Matches the Play title in
`store-listing/play-store.md`.

## Promotional text (170 max, editable without review)

```
KJV Bible study with AI: audio Bible, verse of the day, prayer and reading plans
```

80 characters, identical to the Play short description (Austin, 2026-10-09: both stores say the same thing).

## Description (4000 max)

```
Come hungry for the Word.

"Heaven and earth shall pass away, but my words shall not pass away." Matthew 24:35

Nothing you read today matters more than the Word of God. SureWord is a KJV Bible app and personal Bible study companion with AI, made for Christians who believe the King James Bible is the inerrant, infallible Word of God. Read it, hear it, study it and live it every day, with a guide that learns where you are in your walk with the Lord and always points you back to Scripture.

ASK THE BIBLE ANYTHING
• Answers that search the Scriptures first and quote the King James Version word for word, every verse one tap from the reader
• Find the verse you half remember, by meaning or by exact words
• Cross-references that trace a verse through the whole Bible
• Hebrew and Greek word study with Strong's concordance numbers
• Copy, edit and try again; share, save or rate any answer

TEST EVERYTHING BY SCRIPTURE
• /check weighs a claim, a message or a screenshot against the Bible
• /verify tests what a sermon video, YouTube video or web page teaches, claim by claim
• /reply helps you answer a friend with grace and truth
• Ask with a photo, PDF, text file or voice message, or share one in from any app

READ AND LISTEN TO THE KJV BIBLE
• The complete King James Bible offline, plus the NKJV and the Berean Standard Bible
• Audio Bible: the whole KJV narrated, Genesis to Revelation, verse by verse
• Words of Christ in red on a parchment page, in light or dark mode
• Tap any verse for a clear explanation, word study and related passages
• Highlight verses in eight colors and name what each color means

DAILY DEVOTIONAL: PICK UP YOUR CROSS
• A verse of the day chosen for you from your own reading, questions and notes, with how to live it today (Luke 9:23)
• Stay with today's word, or ask for a fresh one
• A daily reminder at the hour you choose

GROW IN YOUR WALK WITH GOD
• Bible reading plans, guided or built around your own goal
• Your walk: a reading log with your streak, a map of every book and a short reflection on what you have read
• Scripture memory: learn a verse word by word until it is written on your heart
• Bible timeline, people and places, from Creation to Revelation
• Sermon studies: your church's sermons as guided studies for the week, where available

A BIBLE GUIDE THAT KNOWS YOU
• Share your testimony and where you are in your faith, privately, so answers meet you there
• Prayer list: requests that come back to you, so you can mark how God answered
• My church: save your congregation, and SureWord keeps it in mind
• Memory you control: see, add or delete everything SureWord remembers

BIBLE STUDY NOTES
• Notes with folders, tags, templates and linked notes
• SureWord can find, read, add to and tidy your notes when you ask

YOUR CHOICE OF AI
• SureWord AI works the moment you sign in, or bring your own OpenAI, Anthropic, Moonshot or OpenRouter key

SUREWORD PRO
An optional monthly subscription adds Listen (the daily devotional read aloud), more AI messages each day, deeper reasoning and unlimited voice message transcription.

PRIVATE BY DESIGN
• No ads, and your study is never sold
• Delete your account and everything in it from Settings at any time

SureWord is a study aid, not a replacement for your Bible or your church. AI can make mistakes, so search the Scriptures daily to see whether these things are so (Acts 17:11).

One account on your phone, tablet, Mac and the web at sureword.app.

Open the Word today. Come hungry.

Payment is charged to your Apple Account at confirmation of purchase. The subscription renews automatically unless cancelled at least 24 hours before the end of the current period, and can be managed or cancelled in your App Store account settings.

Terms of Use: https://sureword.app/terms
Privacy Policy: https://sureword.app/privacy
```

Measured length: 3834 characters (limit 4000), counted by code point.

One description for both stores (Austin, 2026-10-09): this text is the Play
full description in `store-listing/play-store.md` word for word, plus the App Store's
required subscription terms and links at the end. Change both together. It
opens with why the Word matters (Matthew 24:35) and names, in plain phrases,
what people search for: KJV Bible, King James Version, audio Bible, verse of
the day, daily devotional, Strong's concordance, Bible reading plans, prayer
list, Scripture memory, Bible timeline, Bible study notes. Apple does not
index the description for search (the name, subtitle and keywords do), but
Play does, so the phrases earn their place there. Not yet entered in App
Store Connect; see the PENDING block at the top.

Verify before submitting (delete a line from the description if its row is
not `verified` for the build being submitted):

- "/check" and "/reply" and voice messages: PROGRESS rows D6 and D7 are `source`
  today; both must be `verified`.
- "/verify": `docs/PARITY.md` iOS row (🟡 today).
- "Copy, edit and try again": PROGRESS D3 and the PARITY copy/edit row (Apple
  1.13.0).
- "Audio Bible": PARITY Audio Bible row (Apple 1.12.0, 🟡 today).
- "Your walk" reading log: PROGRESS C10 (`source` today).
- "Sermon studies": PROGRESS C11 (`source` today).
- "Prayer list": PARITY prayer-request row (⚠️ shared code today).
- "Scripture memory": PROGRESS C8 (Learn a verse).
- "Bible reading plans": PROGRESS C7 (`source` today).
- "Stay with today's word, or ask for a fresh one": PROGRESS D4.
- "templates and linked notes": PROGRESS E1 and E3 (`source` today).
- "share one in from any app": PROGRESS D8.
- "Delete your account ... from Settings": PROGRESS A1 client row.
- "word study": PROGRESS C2.
- "Bible timeline, people and places": PROGRESS C9 (`source` today).

## Keywords (100 max, comma separated, no spaces)

```
king james,audio,devotional,verse,day,scripture,study,prayer,christian,ai,strongs,concordance,plan
```

98 characters. Words already in the name or subtitle (SureWord, Personal,
Bible, Guide, Walk, Word, KJV) are indexed from there and left out; Apple
combines words across fields, so "audio" + Bible finds "audio Bible", "verse" +
"day" finds "verse of the day", "strongs" + "concordance" finds "Strong's
concordance" and "plan" finds "Bible reading plan". Reworked 2026-10-09 for
search; "jesus", "faith", "church" and "notes" were dropped to make room. No
competitor names.

## Categories

- Primary: **Reference**
- Secondary: **Lifestyle**

(Play uses Books & Reference; Apple has no combined category.)

## URLs

| Field | URL |
|---|---|
| Support URL | https://sureword.app/support |
| Marketing URL | https://sureword.app |
| Privacy Policy URL | https://sureword.app/privacy |

`/support` and `/privacy` are public (signed-out) pages, checked in
`tests/llms-txt.test.mjs`, which also fails if either one ever shows a price or
a purchase link.

## Copyright

```
2026 LineCrush Inc
```

## Age rating questionnaire

Apple's questionnaire (the 2025 revision with 4+, 9+, 13+, 16+, 18+) asks for
None / Infrequent / Frequent per content type and Yes / No per feature. Field
names below follow that revision; match them to whatever App Store Connect shows
on the day.

### Content

| Item | Answer | Reasoning |
|---|---|---|
| Profanity or crude humor | None | Answers are written in a reverent register; the KJV text has no profanity in the modern sense. |
| Horror or fear themes | None | Judgment and prophecy are taught as Scripture, not presented as horror. |
| Alcohol, tobacco or drug use or references | Infrequent | Scripture mentions wine and drunkenness, and the assistant can explain those passages. No depiction or encouragement. |
| Mature or suggestive themes | Infrequent | The Bible text includes adultery, sexual sin and similar accounts (for example Genesis 19, 2 Samuel 11), and the AI can discuss them when asked. Text only. |
| Sexual content or nudity | None | No images; discussion stays at the level of the Scripture text. |
| Cartoon or fantasy violence | None | |
| Realistic violence | Infrequent | Biblical accounts of war, martyrdom and the crucifixion, in text. |
| Prolonged graphic or sadistic realistic violence | None | |
| Guns or other weapons | None | |
| Medical or treatment information | None | Not a medical app; the terms say SureWord is not a replacement for professional help. |
| Health or wellness topics | None | |
| Simulated gambling, gambling, contests, loot boxes | None | |

### Features

| Item | Answer | Reasoning |
|---|---|---|
| Unrestricted web access | No | There is no in-app browser. Web search (Tavily, toggle in Settings) returns summarized results inside an answer, and tapping a result opens Safari. |
| User-generated content | No (decision for Austin) | No user can see another user's content inside the app. "Share an answer" mints a link to a read-only page on sureword.app that the owner sends themselves and can revoke; "Show in search" lets that page be indexed. If App Review reads that as UGC, guideline 1.2 needs report, block and filter mechanisms. |
| Messaging and chat | No | Chat is with the AI assistant, never between users. If the form adds a question about AI chatbots or AI-generated content, answer Yes. |
| Advertising | No | No ads, no ad SDKs. |
| Parental controls | No | |
| Age assurance | No | |

### Expected result and recommendation

These answers compute to roughly 9+ (infrequent realistic violence and mature
themes). Recommendation: if App Store Connect offers a higher rating than the
computed one, select **13+**. It matches the privacy policy ("not directed to
children under 13"), the Play target audience (13+ / 18+, never under 13), and
the fact that an open-ended AI chat can be asked about anything in Scripture.
**Decision for Austin.**

## Check command

```bash
# Description length with HTML comments stripped (must be < 4000):
awk '/^## Description/{f=1;next} f&&/^```$/{n++; if(n==2) exit; next} f&&n==1' store-listing/app-store.md \
  | grep -v '^<!--' | wc -m
```
