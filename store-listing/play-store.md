# Google Play listing copy (Android)

The exact text for SureWord's Play Store page. Start at
[`store-listing/README.md`](README.md); the App Store twin is
[`app-store.md`](app-store.md), and `tests/store-listing-parity.test.mjs`
keeps the two identical.

Live on Play since 2026-10-25 (published by API). Check or publish with
`node mobile/scripts/play-listing.mjs check|apply`.

## Title (30 max)

| Field | Text | Chars (limit) |
|---|---|---|
| App name | `SureWord: Personal Bible Guide` | 30 (30) |

The store title only: the launcher label on the device stays `SureWord`.
Chosen by Austin on 2026-10-09 (was `SureWord`); same as the App Store name.

## Short description (80 max)

```
KJV Bible study with AI: audio Bible, verse of the day, prayer and reading plans
```

80 characters. Identical to the App Store promotional text.

## Full description (4000 max)

```
Come hungry for the Word.

"Heaven and earth shall pass away, but my words shall not pass away." Matthew 24:35

SureWord is a KJV Bible app and personal Bible study companion with AI for Christians who believe the King James Bible is God's inerrant, infallible Word. Study Scripture first.

ASK THE BIBLE ANYTHING
• Answers that search the Scriptures first and quote the King James Version word for word, every verse one tap from the reader
• Find the verse you half remember, by meaning or by exact words
• Cross-reference map: trace any verse through the whole Bible
• Hebrew and Greek word study with Strong's concordance numbers
• Copy, edit, retry, share, save or rate any answer
• Answers in English, Spanish or German

TEST EVERYTHING BY SCRIPTURE
• /check weighs a claim, a message or a screenshot against the Bible
• /verify tests what a sermon video, YouTube video or web page teaches, claim by claim
• /reply helps you answer a friend with grace and truth
• Ask with a photo, PDF, text file or voice message, or share one in from any app

READ AND LISTEN TO THE KJV BIBLE
• The whole King James Bible offline, plus the NKJV, BSB, Reina-Valera and Luther
• Audio Bible: the whole KJV narrated, Genesis to Revelation, verse by verse
• Words of Christ in red, on parchment, light or dark
• Adjustable text size across chat, Scripture, notes and menus
• Tap any verse for a clear explanation, word study and related passages
• Highlight verses in eight colors and name what each color means
• Share verse cards with AI or your own words and fonts
• Send a verse and a word of encouragement to someone you love

DAILY DEVOTIONAL: PICK UP YOUR CROSS
• A verse of the day chosen for you from your own reading, questions and notes, with how to live it today (Luke 9:23)
• Stay with today's word, or ask for a fresh one
• Share today's word as a card
• A daily reminder at the hour you choose

GROW IN YOUR WALK WITH GOD
• Today for your daily walk; Study for notes, word study, timeline and sermons
• Bible reading plans, guided or built around your own goal
• Your walk: a reading log, your streak, a map of every book and a reflection on your reading
• Scripture memory: learn a verse word by word until it is written on your heart
• Bible quiz after each chapter, every answer with its verse
• Bible timeline, people and places, from Creation to Revelation
• Sermon studies: your church's sermons as guided weekly studies, where available

A BIBLE GUIDE THAT KNOWS YOU
• Share your testimony and where you are in your faith, privately, so answers meet you there
• Prayer list: requests that come back to you, so you can mark how God answered
• My church: save your congregation, and SureWord keeps it in mind
• Ways to Serve: optional ways to love others
• Memory you control: see, add or delete everything SureWord remembers

BIBLE STUDY NOTES
• Notes with folders, tags, templates and linked notes
• SureWord can find, read, add to and tidy your notes when you ask

SUREWORD AI
• SureWord AI works the moment you sign in, no setup needed

SUREWORD PRO
An optional monthly subscription adds Listen (the daily devotional read aloud), more AI messages each day, deeper reasoning and unlimited voice message transcription.

PRIVATE BY DESIGN
• No ads, and your study is never sold
• Delete your account and everything in it from Settings at any time

SureWord is a study aid, not a replacement for your Bible or your church. AI can make mistakes, so search the Scriptures daily to see whether these things are so (Acts 17:11).

One account on your phone, tablet, Mac and the web at sureword.app.

Open the Word today. Come hungry.
```

3634 characters. It is the App Store description word for word, minus
Apple's subscription terms footer (Austin, 2026-10-09: one description for
both stores, every feature, written for search and to open with why the Word
matters). Play indexes this text for search, so features are named in the
phrases people type: KJV Bible, audio Bible, verse of the day, daily
devotional, Strong's concordance, Bible reading plans, prayer list, Scripture
memory, Bible timeline. No competitor names, no "best"/"#1", no dashes.

## Where it goes

Play Console → SureWord → Grow users → Store presence → Store listings →
Edit default listing (`.../app/4976411638093672168/store-listings/default/edit`):
inputs are App name, Short description, Full description; **Save as draft**,
then send the change for review from Publishing overview when it offers to.
The publisher service account can stage listing edits through the API but the
commit returns 403 until it is granted Store presence. Graphics, category and
contact details stay in `docs/PLAY_STORE.md` step 4.
