# App Store listing copy (PRD H3)

Status: **draft, not entered in App Store Connect.** Austin enters it when he
creates the app record (H1). Copy follows the Mission in `CLAUDE.md`: SureWord
speaks as a believer who holds the King James Bible as the inerrant Word of
God, without claiming the AI is infallible.

Rules for this file:

- Claim only what the iPhone/iPad build does at submission. Source of truth is
  the iOS column of `docs/PARITY.md` plus `docs/ios/PROGRESS.md`.
- Lines that depend on an in-flight lane carry an HTML comment naming the PRD
  row. Before submitting, delete the comment if the row is `verified`, or
  delete the line if it is not.
- No price, no "Pro", no purchase wording (PRD F1, guideline 3.1.1/3.1.3),
  and no competitor names.
- Character counts below were measured with `wc -m` on the exact text.

## Name and subtitle

| Field | Text | Chars (limit) |
|---|---|---|
| Name | `SureWord` | 8 (30) |
| Subtitle | `KJV Bible Study with AI` | 23 (30) |

Alternative if "SureWord" alone is taken or Austin wants the name to carry a
keyword: Name `SureWord: KJV Bible Study` (25) with Subtitle
`Ask, read and study the Word` (28).

## Promotional text (170 max, editable without review)

```
Come hungry for the Word. Ask any Bible question and get answers grounded in the King James Bible, then read, highlight and keep your notes in one quiet place.
```

159 characters.

## Description (4000 max)

```
Come hungry for the Word.

SureWord is a Bible study companion for Christians who hold the King James Bible as the inerrant, infallible Word of God. Ask a question, and SureWord searches the Scriptures first, then answers from them, quoting and citing the verses so you can read every one in its context.

"As newborn babes, desire the sincere milk of the word, that ye may grow thereby" (1 Peter 2:2).

ASK, AND SEE WHAT IS WRITTEN
• Ask anything about the Bible and get an answer that quotes the King James text word for word, with every reference one tap from the reader
• Finds the passage you half remember, by meaning or by exact words
• Cross-references that trace a verse through the whole Bible
• The Hebrew and Greek behind a verse, word by word, with Strong's numbers
• Attach a photo, screenshot, PDF, or text file to your question
• Share a voice message, and SureWord transcribes it and weighs what was said against Scripture with /check, then helps you write a gentle reply with /reply
• Optional web search for current events, which you can turn off in Settings

READ THE BIBLE
• The complete King James Bible, built into the app and readable offline, with the NKJV also available
• Search the text and jump straight to any reference
• Tap a verse for a reverent explanation and a word study
• Highlight verses in eight colours, and name what each colour means to you
<!-- B5: highlight labels are "uncompiled" on iOS in PARITY; drop the second half of the line above unless verified -->
• Timeline, People and Places: walk Bible history and see who and where a chapter is about
<!-- C5: add "the Berean Standard Bible" to the translations line only if C5 is verified -->
<!-- C4: "A parchment reading surface, light or dark" only if C4 is verified -->
<!-- C6: "Pick up where you left off" only if C6 is verified -->

PICK UP YOUR CROSS
• Each day, one verse chosen for you from what you have been reading, asking and noting, with why it was chosen and how to live it today (Luke 9:23)
• Ask for a different word for today whenever you need one
• A daily reminder at the hour you choose
<!-- B6: replace the reminder line with "A morning notification that leads with the verse itself" only if B6 (APNs) is verified -->
<!-- D4 / F1: Listen (spoken devotional) is a Pro benefit with no purchase on iOS; do not list it unless the F1/F2 decision makes it available to every iOS user -->

YOUR STUDY, KEPT TOGETHER
• Rich Bible study notes with folders, tags and pins
• The assistant can find your notes by meaning, read them, add to them, and tidy them when you ask
• Save any answer to a note
• Memory: SureWord remembers what you ask it to, and you can see, add, delete or turn off everything it keeps
• About me and My testimony: tell SureWord where you are in your walk, privately, so answers meet you there
• My church: save your congregation, and SureWord keeps it in mind
<!-- C7: "Reading plans: choose a guided plan or have SureWord build one around your goal" only if C7 is verified -->
<!-- C8: "Learn a verse: hide it word by word until it is written on your heart" only if C8 is verified -->
<!-- C11: "Sermon studies from your church's recorded services" only if C11 is verified -->
<!-- E1/E3: templates and linked notes only if E1/E3 are verified -->
<!-- D8: "Share a screenshot, link or voice message into SureWord from any app" only if D8 is verified -->

YOUR CHOICE OF MODEL
• SureWord works the moment you sign in
• Add your own OpenAI, Anthropic, Moonshot or OpenRouter key in Settings to use that provider's models, billed by your provider

PRIVATE BY DESIGN
• No ads, and your study is never sold
• Delete your account and everything in it from Settings at any time

SureWord is a study aid, not a replacement for your Bible or your local church. Its AI can make mistakes, so search the Scriptures daily to see whether these things are so (Acts 17:11).

Also on Android, Mac and the web at sureword.app, with your study kept in step across them.
```

Measured length with the HTML comments removed: 2884 characters (check command
at the end of this file). Must stay under 4000, so every commented line can be
restored without trimming.

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
