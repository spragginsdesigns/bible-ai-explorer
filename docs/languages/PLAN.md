# Other languages: Bibles, answers, and the app itself

**Status:** Planned (2026-10-26). Not built. Idea from David Rowan, closed-testing
coordinator, 2026-10-25/26. He suggested Spanish, French, German and Italian after
English. Austin asked to start with the languages "we know for sure we can do
right properly", to put the choice in Settings, and to plan it out.

## The rule that decides everything

SureWord believes the KJV is the Word of God. Moving into another language does not
mean letting an AI translate Scripture. Every verse a reader sees in another language
comes from a real, historic, public-domain Bible in the same Received Text
tradition as the KJV, word for word, never machine-translated. An AI can write the
*answer* in Spanish, but every verse it quotes is looked up from the shipped Bible
text, the same way it quotes the KJV today (`getVerseText` in
`src/lib/bible/translations.ts`, used by the chat tools in `src/lib/ai-tools.ts`).

## Which Bibles, and how ready each one is

All four are public domain and published by eBible.org (VPL/USFM downloads,
copyright statements at https://ebible.org/Scriptures/copyright.php). On
2026-10-26 each was downloaded and every chapter's verse count was compared with
our bundled KJV (`src/data/kjv`):

| Language | Bible | Chapters | Verse numbering vs KJV | Ready? |
|---|---|---|---|---|
| German | Lutherbibel 1912 (`deu1912`) | 1189 | Already in KJV numbering: 31,102 verses, zero mismatches. Where Luther numbers differently, eBible keeps the KJV slot and marks the original as `[2:1]`, which we strip. | **Yes** |
| Spanish | Reina-Valera 1909 (`spaRV1909`) | 1189 | Chapter counts match, but 18 verses are empty because the text sits under the Spanish numbering (Jonah 1:17 is printed as 2:1, Acts 19:41 is folded into 19:40). Needs about 20 hand-checked moves: Num 12-13 and 29-30, 1 Sam 23-24, 2 Sam 20, 2 Chr 33, Job 35 and 38-41, Hos 11-12, Jon 1-2, Acts 19, 2 Cor 13. | **Yes, after a small fix table** |
| French | Louis Segond 1910 (`fraLSG`) | 1189 | 106 chapters differ. It follows Hebrew numbering: psalm titles are verse 1, plus Exod 7-8, Lev 5-6, Job 38-41, Joel, Malachi 3-4 and others. This is a standard, well-documented mapping, but it is a real table to build and test. | Second |
| Italian | Diodati 1885 (`ita1885`) | 1189 | 44 chapters differ, and irregularly (Gen 35, Eccl 11-12, Ezek 20-21, Mark 9, Gal 3, Col 3...). Each one has to be read by hand. | Third |

Rejected for now:

- **Reina-Valera 1960.** It's what most Spanish-speaking churches read, but it's
  copyrighted by the Bible Societies and would need a license. RV1909 is its
  public-domain parent. Revisit RV1960 (or the KJV-aligned Reina-Valera Gomez) only
  with a license in hand.
- **Portuguese.** No classic Almeida edition is offered as public domain on
  eBible, only modern free translations. Brazil is a big audience, so this needs its
  own source search before it is planned.

**So the first wave is Spanish (RV1909) and German (Luther 1912).** French comes
next once its numbering table passes the same check. Italian follows after that.

## Three layers, shipped in this order

### Layer 1: the Bible in your language (reader + AI quotes)

What the reader gets: in Settings, the Bible translation list grows an "Other
languages" group: Reina-Valera 1909 (Español), Lutherbibel 1912 (Deutsch). Choose one
and the reader, verse sheet, share cards, verse-of-the-day text and every verse the
AI quotes use it, the same way BSB and NKJV work today. The book names show in that
language (Juan, Johannes), and so do references ("Juan 3:16").

How:

1. `scripts/bible/build-ebible.py` (sibling of `build-bsb.py`): takes an eBible VPL
   file plus a per-Bible versification table (`scripts/bible/versification/<id>.json`),
   writes `src/data/<id>/NN.json` in the BSB book shape, strips eBible's `[n:n]`
   markers and bracketed supplied-word marks the same way the KJV is handled, and
   **fails the build unless all 31,102 KJV slots are filled** (a slot may only be
   empty where the KJV itself has no verse). That check is what makes "properly"
   provable instead of hoped.
2. Book names per language: `src/data/books.<lang>.json` (66 names + common
   abbreviations), used for display and for parsing typed references ("Jn 3:16",
   "Juan 3:16", "Joh 3,16" for German's comma).
3. `TranslationId` gains `RV1909` and `LUT1912`. Today that union is hand-copied in
   about 10 places (`mobile/src/lib/receipts.ts`, `receiptRoutes.ts`, `chatView.ts`,
   `shareCards.ts`, `verseActions.ts`, `settingsStore.ts`, `preferences.ts`,
   `bible/search.tsx`, `src/app/v/[slug]/page.tsx`...). Step one is to centralise it
   into one `isTranslationId()` per client so adding a Bible is one line. Every
   client's `TRANSLATIONS` entry gains `language` and `nativeName`.
4. Delivery:
   - **Web/API:** bundled server-side like BSB, loaded lazily per book.
   - **Android:** KJV and BSB are bundled. Bundling every new Bible would add about
     4 MB each to the APK for readers who will never open them. New Bibles are
     downloaded **once, when chosen**, from a new `GET /api/bible/<id>/<book>`
     (immutable, CDN-cached) and stored on the device so the reader works offline
     afterwards. Settings shows "Downloading... / Ready offline".
   - **macOS/iOS:** same download-on-choose path in `BibleTranslations.swift`.
5. Search: the KJV word index stays English. The `findVerses` tool description
   already says its wording is KJV; for a non-English reader the model searches in
   English and quotes the reader's Bible. Semantic search (`searchScripture`) uses
   multilingual embeddings, so a Spanish question still finds the right verses
   (to be proven with a fixed set of 20 Spanish and German questions before release).
6. Features tied to English wording stay English and say so: Strong's/original
   language tools work on verse references, so they still work. Red letters use
   verse ranges, so they carry over. The Audio Bible stays KJV English (label it).

### Layer 2: SureWord answers in your language

A separate setting, **Answer language** (defaults to the language of the chosen
Bible, so most people never touch it). The server adds one instruction to the
system prompt: answer in Spanish, quote only from the reader's Bible through the
tools, never translate a verse yourself, and keep the same KJV-believing convictions
in every language. The SureWord voice rules in `src/utils/systemPrompt.ts` do not
change. Daily devotional, verse-of-the-day reflection, memory extraction and notes
summaries follow the same setting. "Listen" (ElevenLabs) stays English until a voice
is chosen per language.

Quality gate: a fixed eval set (20 questions per language, including doctrine
questions where a weaker answer would soften Scripture) reviewed by a fluent
believer before the language ships. **David speaks Spanish, German and French**, so
he is the natural first reviewer (paid, through the existing Fiverr relationship).

### Layer 3: the app itself in your language (menus, buttons, settings)

The largest piece, and the one Austin was right to worry about. Button text
translated badly is embarrassing, but it never changes Scripture, so the approach is:
AI drafts every string, a fluent believer reviews every string before release, and a
language ships only when 100% of its strings are reviewed.

- **Web:** `next-intl` (App Router native), strings in `messages/<lang>.json`.
- **Android:** `i18next` + `expo-localization`, the same keys and JSON files
  (shared source of truth, copied by a script, as other mirrored files are).
- **macOS/iOS:** String Catalogs (`Localizable.xcstrings`) generated from the same
  JSON.
- **Store listings:** localized Play and App Store text in `store-listing/<lang>/`,
  under the same parity test.
- App language follows the phone's language by default, with an override in
  Settings → Language.

Extracting the strings means touching every screen on four clients, so Layer 3 is its own
release cycle after Layers 1 and 2 have proven there are readers who want it
(PostHog: count readers on a non-English Bible).

## Settings shape (every client)

Settings → **Language** (new page, all four clients, parity tracked in
`docs/PARITY.md`):

- **Bible**: the existing translation list, grouped by language. Non-English
  entries show their download state.
- **SureWord answers in**: Follow my Bible (default) / English / Español /
  Deutsch.
- **App language** (Layer 3 only): Follow my phone (default) / English / Español /
  Deutsch.

Stored in the synced preferences document (`/api/preferences`), so the choice
follows the account across devices. New fields: `answerLanguage`, `appLanguage`.
`translation` already exists and just accepts the new ids.

## Milestones

1. **Data pipeline + proof.** `build-ebible.py`, versification tables for
   RV1909 (~20 entries) and Luther 1912 (none), the 31,102-slot check in CI, book
   names. No user-visible change.
2. **Layer 1 for Spanish and German** on Android first, then web, then Apple:
   the reader, picker, verse sheet, share cards, AI quotes, download-on-choose.
   Release notes in `mobile/CHANGELOG.md`.
3. **Layer 2** (answer language) + the reviewed eval set.
4. **French** (Segond numbering table, ~106 chapters) through steps 1-3.
5. **Layer 3** (app strings), Spanish first.
6. **Italian** (Diodati, read by hand), then a Portuguese source search.

## Implementation contract (v1, Spanish + German, built 2026-10-26)

Decisions Austin made on 2026-10-26: build it, and default the language from
the device ("English by default, they can change it in settings").

Changed from the sections above: the Bibles are **bundled** on every client
(lazy-loaded per book, like BSB), not downloaded on demand. Plain-text JSON
compresses to about 1-2 MB each in the APK, works offline from day one, and
needs no download UI.

**Bible data.** `scripts/bible/build-ebible.py` writes `string[][]` per book
(chapters of verses, the KJV shape) to `src/data/{rv1909,lut1912}/NN.json`,
`mobile/src/features/bible/data/{rv1909,lut1912}/NN.json` and
`macos/Shared/Bible/Data/{rv1909,lut1912}/NN.json` (`NN` = 01-66). Every one
of the 31,102 KJV slots is filled; the build aborts otherwise.

**Translation ids.** `RV1909` (label "Reina-Valera 1909", language `es`) and
`LUT1912` (label "Lutherbibel 1912", language `de`), alongside `KJV`, `NKJV`,
`BSB` (all `en`). Each client keeps ONE list (`TRANSLATIONS`, now with a
`language` field) and one `isTranslationId`/`parseTranslationId`; every other
place that hard-coded `"KJV" | "NKJV" | "BSB"` uses those. Copyright line for
both new editions: "Public domain".

**Answer language.** Languages: `en`, `es`, `de`. Account preference
`answerLanguage` = `"auto" | "en" | "es" | "de"`, default `"auto"`, synced
through `/api/preferences` like `textScale` (Prisma `User.answerLanguage`,
default `"auto"`). `"auto"` means follow the device: each client resolves the
**effective language** = the explicit choice, else the device's first preferred
language if it is `es` or `de`, else `en`.

**Chat requests** (`POST /api/ask-question`) send `language: "en" | "es" |
"de"` (the effective language) next to `translation`; the clients also send it
with `POST /api/verse-insight`, where the server does not need it (below). The
server writes the answer in that
language and **quotes the reader's Bible only when it is in that language**;
otherwise it quotes the language's own Bible: `en` KJV, `es` RV1909, `de`
LUT1912 (`quotationTranslation()` in `src/lib/bible/translations.ts`).
A missing or unknown `language` falls back to the account's stored choice
when that is a language, then `en`, so older app builds behave exactly as
before. The language is part of the answer cache key.

**Verse insight and Connections explanations** follow the language of the
Bible being read: a verse tapped in the Reina-Valera is explained in Spanish.
Their caches are keyed by translation, so English rows are untouched and no
prompt version bump was needed. (Connections explanations are still English in
v1.)

**Settings.** A **Language** section on every client: "SureWord answers in":
Follow my device (shows what it resolved to, e.g. "Follow my device
(Español)") / English / Español / Deutsch. Choosing a specific language also
switches the reader's Bible to that language's Bible when the current Bible is
in another language (English goes back to KJV; a BSB or NKJV reader who
picks English keeps their Bible). "Follow my device" leaves the Bible alone. The Bible picker lists the two
new Bibles with their language ("Reina-Valera 1909 · Español").

**References.** Answers in Spanish or German write references with that
language's book names and a colon ("Juan 3:16", "Johannes 3:16"). The names
live in `src/data/book-names.json` (mirrored to mobile and macOS), and every
client's reference resolver and chat link detector accept them (accents and
the German "1." optional).

Not in v1: menus and buttons stay English (Layer 3); the Audio Bible, Listen,
daily devotional and memory extraction stay English; the KJV word index
(`findVerses`) stays English.

**Known text difference.** The Lutherbibel 1912 omits 1 John 5:7 as the KJV
reads it ("three that bear record in heaven", the Comma Johanneum); the
Reina-Valera 1909 includes it. Austin decides whether that is acceptable for a
KJV-rooted app; every Luther-tradition German Bible that includes the verse is
still under copyright.

## Open questions for Austin

- Is Reina-Valera 1909 acceptable as *the* Spanish Bible, given most Spanish
  churches read the 1960? (The 1909 is the public-domain one we know is safe to use.)
- Pay David to review Spanish and German answers and strings, or find reviewers
  from church?
- Free or Pro? Recommendation: Bibles and answers in every language are free (it's
  the Word), the same as the KJV.
