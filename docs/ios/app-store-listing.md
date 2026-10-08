# App Store listing copy (PRD H3)

Status: **entered in App Store Connect on 2026-10-07** (version 1.10.0, en-US)
through the API. This file mirrors what is live there; change both together. Copy follows the Mission in `CLAUDE.md`: SureWord
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
| Name | `SureWord` | 8 (30) |
| Subtitle | `KJV Bible study, made personal` | 30 (30) |

Alternative if "SureWord" alone is taken or Austin wants the name to carry a
keyword: Name `SureWord: KJV Bible Study` (25) with Subtitle
`Ask, read and study the Word` (28).

## Promotional text (170 max, editable without review)

```
Your daily walk with God, rooted in the King James Bible. A verse chosen for you each morning, answers that cite Scripture, and study that remembers your journey.
```

162 characters.

## Description (4000 max)

```
A Bible study that knows your walk.

SureWord is a personal Bible study companion for Christians who hold the King James Bible as the inerrant, infallible Word of God. It learns where you are in your walk with the Lord, from what you read, ask, note and tell it, and meets you there. Every answer searches the Scriptures first, then quotes and cites the verses so you can read each one in its context.

"Thy word is a lamp unto my feet, and a light unto my path" (Psalm 119:105).

PICK UP YOUR CROSS, EVERY MORNING
• Each day, one verse chosen for you from your own reading, questions and notes, with why it was chosen and how to live it today (Luke 9:23)
• Ask for a different word for today whenever you need one
• A gentle reminder at the hour you choose

STUDY THAT KNOWS YOU
• About me and My testimony: tell SureWord where you are in your walk, privately, so answers meet you there
• My church: save your congregation, and SureWord keeps it in mind
• Memory: SureWord remembers what you ask it to, and you can see, add, delete or turn off everything it keeps
• Learn a verse: hide it word by word until it is written on your heart
• Reading plans, guided or built around your own goal

ASK, AND SEE WHAT IS WRITTEN
• Ask anything about the Bible and get an answer that quotes the King James text word for word, every reference one tap from the reader
• Find the passage you half remember, by meaning or by exact words
• Cross-references that trace a verse through the whole Bible
• The Hebrew and Greek behind a verse, word by word, with Strong's numbers
• Attach a photo, screenshot, PDF or text file to your question, or share one into SureWord from any app
• Optional web search for current events, which you can turn off in Settings

READ THE BIBLE
• The complete King James Bible built in and readable offline, with the NKJV and the Berean Standard Bible also available
• Words of Christ in red, a parchment reading surface, light or dark
• Pick up where you left off, and keep a reading log of your journey through the Word
• Tap a verse for a reverent explanation and a word study
• Highlight verses in eight colours
• Timeline, People and Places: walk Bible history and see who and where a chapter is about

YOUR STUDY, KEPT TOGETHER
• Bible study notes with folders, tags, pins, templates and linked notes
• The assistant can find your notes by meaning, read them, add to them and tidy them when you ask
• Save any answer to a note

YOUR CHOICE OF MODEL
• SureWord works the moment you sign in
• Add your own OpenAI, Anthropic, Moonshot or OpenRouter key in Settings to use that provider's models, billed by your provider

SUREWORD PRO
An optional monthly subscription adds the spoken daily devotional (Listen) and unlimited voice message transcription. Payment is charged to your Apple Account at confirmation of purchase. The subscription renews automatically unless cancelled at least 24 hours before the end of the current period, and can be managed or cancelled in your App Store account settings.

PRIVATE BY DESIGN
• No ads, and your study is never sold
• Delete your account and everything in it from Settings at any time

SureWord is a study aid, not a replacement for your Bible or your local church. Its AI can make mistakes, so search the Scriptures daily to see whether these things are so (Acts 17:11).

Also on Android, Mac and the web at sureword.app, with your study kept in step across them.

Terms of Use: https://sureword.app/terms
Privacy Policy: https://sureword.app/privacy
```

Measured length: 3566 characters (limit 4000).

Verify before submitting:

- "/check" and "/reply" and voice messages: PROGRESS rows D6 and D7 are `source`
  today; both must be `verified`.
- "Delete your account ... from Settings": PROGRESS A1 client row.
- "word study": PROGRESS C2.
- "Timeline, People and Places": PROGRESS C9 (`source` today).

## Keywords (100 max, comma separated, no spaces)

```
scripture,devotional,king james,verse,christian,jesus,gospel,prayer,faith,church,notes,concordance
```

98 characters. Words already in the name or subtitle (SureWord, KJV, Bible,
Study, AI) are indexed from there and left out. No competitor names.

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
awk '/^## Description/{f=1;next} f&&/^```$/{n++; if(n==2) exit; next} f&&n==1' docs/ios/app-store-listing.md \
  | grep -v '^<!--' | wc -m
```
