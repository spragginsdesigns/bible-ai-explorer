# Sermon to Study (`sermons`, LC-17643)

`/beta/study/sermons`. Record or upload a sermon the founder has permission to
use; SureWord transcribes it with timestamps, finds every passage it names or
quotes, and on request writes a study of it: notes for each movement,
discussion questions and verses to memorise. Each passage can be compared with
its biblical context, and any question can be marked for later research. The
sermon's words and Scripture are never mixed (below).

Status `building`: everything above shipped. Saving a sermon into a Study
Project (LC-17642) waits for Study Projects to reach `main`; until then a
sermon is its own item in the shared study store, which the Knowledge Vault
already indexes.

## Flow

1. **Permission first.** Upload and Record stay disabled until the founder
   ticks "I have permission to use this recording". `POST /api/beta/sermons`
   refuses `permission !== true`, and the confirmation time is kept on the
   sermon (`permissionAt`) and shown on its page.
2. **The browser cuts the audio** (`components/beta/sermons/audio.ts`). The
   file or recording (MediaRecorder: Opus/WebM, or AAC/MP4 on Safari) is
   decoded straight to 16 kHz mono through an `OfflineAudioContext`, then cut
   into WAV pieces of at most 110 seconds, each at the quietest 50 ms in the
   last 15 seconds of its window so a word is rarely split, never leaving a
   last piece under two seconds. A piece is about
   3.5 MB, under Vercel's 4.5 MB request limit, so no blob storage is needed
   and the audio is never stored.
3. **Each piece is transcribed in order** (`POST .../pieces?index=n`). The
   server accepts only the exact WAV shape the browser makes
   (`isSermonWav`), at most 111 seconds, in order; a repeated piece (a retry)
   is answered without paying again. Whisper-1 is the OpenAI transcription
   model that returns segment timestamps (`gpt-4o-mini-transcribe`, which
   voice messages use, does not). The prompt is voice messages'
   `BIBLE_TRANSCRIPTION_PROMPT` plus the last 300 characters already heard,
   so names and sentences carry across pieces. Each piece's segments are
   moved onto the whole recording's clock from the server's own running
   total of piece lengths, never a number the browser sends.
4. **Passages** (`POST .../finish`, no AI):
   - *Named*: a spoken reference ("Second Corinthians chapter 4, verse 7",
     "Romans 5:8", "John chapter three, verse sixteen", "Psalm 23", and
     Whisper's "2 Corinthians 4, 7" for a spoken "four seven") is read
     by `spokenReferencePattern` and resolved with the app's own
     `resolveReference`. Book names must be capitalised and followed by a
     chapter, so "made his mark 3 times" is not Mark 3; a numbered book needs
     its number.
   - *Quoted*: every run of four words in the transcript is looked up in all
     31,102 verses of the bundled KJV. A verse counts as quoted where two or
     more of its runs are heard within a minute of each other and they cover
     half the verse (or six runs of a long one), ignoring runs shared by more
     than six verses ("and it came to pass", Psalm 136's refrain). Runs
     scattered across a long sermon do not add up, and each separate place a
     verse is quoted becomes one of its times. Paraphrase does not count.
   - Merged in the order the sermon reaches them, each with every moment it
     comes up. A verse found both ways is "named".
5. **The page** (`/beta/study/sermons/<id>`) has four tabs:
   - *Passages*: each passage's KJV text with a verse either side (Scripture
     on a gold rule, serif) beside the sermon's words around its first mention
     (dashed rule, italic, with the time), "Read in context" into the reader,
     and every "heard at" time jumping into the transcript.
   - *Study*: written on request. Big idea and summary, the sermon's movements
     (each with a time, a preacher quote, its passage's KJV text, a study note
     and a reflection question), living it out, discussion questions, and up
     to four verses to memorise with the canonical `AddLearnButton`, so a card
     goes into Learn a verse (`VerseMemory`, source `suggestion`), not a
     parallel deck.
   - *Transcript*: every segment with its time, searchable.
   - *Research*: the questions marked "Research later" from the study and the
     comparisons.
   - *Compare with its context* (per passage, on request): what the passage
     says where it stands (from the KJV verses around it), how the sermon used
     it, a gentle judgement (close to the text, applies the text, goes beyond
     the text) labelled as SureWord's interpretation, and questions to weigh.

## Scripture and the sermon's words

- Scripture shown anywhere in the module comes from the bundled KJV on the
  server (`getKjvChapter`), never from the model or the transcript.
- A preacher quote in the study is kept only if it is found word for word in
  the transcript (`quoteIsVerbatim`); otherwise it is dropped.
- A study passage is kept only when it resolves; a memory verse only when it
  is one of the sermon's own verse-level passages.
- The prompts carry SureWord's system prompt, tell the model the transcript is
  material and not instructions, forbid quoting verses in its own fields, and
  ask it to label interpretation and say gently where a sermon goes beyond the
  text.

## Data

One item per sermon in the shared study store, module `sermons`, kind
`sermon`, topic `sermon`. No table and no migration.

- `title`: the founder's title, or the file name.
- `body`: what the Knowledge Vault indexes (`sermonBody`): title and
  preacher, the passages, the study, the questions marked for research, then
  the transcript line by line with times, labelled as the sermon's words.
- `refs`: every passage's verse key and its chapter key.
- `data` (`SermonData` in `sermons-rules.ts`): `status`
  (`transcribing`/`ready`), `preacher`, `permissionAt`, `source`
  (`upload`/`recording`), `fileName`, `durationSec`, `parts` (seconds per
  transcribed piece), `segments` (`start`, `end`, `text`), `passages`,
  `study`, `comparisons`, `research`. A 90-minute sermon is about 100 KB, well
  under the store's 256 KB.

Deleting a sermon deletes the item; account deletion cascades through
`BetaItem`. Up to 60 sermons are kept.

## AI and spend

- Transcription runs only on the founder's own upload or recording, after the
  permission box: whisper-1 at about $0.006 per audio minute, capped at 90
  minutes a sermon (about $0.54). It uses the house OpenAI key and requires
  current AI consent, like voice messages.
- The study and each comparison are one structured call each, only on their
  button, through `resolveModel` (house model, `effort: "low"`) and metered as
  included AI (`withIncludedAiRequest`, surface `beta-sermons`).
- Nothing runs on a schedule, nothing is pre-generated, and finding passages
  is local text matching with no AI.

## API

Every route starts with `requireBetaApi()`; anyone off `BETA_USER_IDS` gets
the ordinary 404 and a signed-out request 401.

| Route | Does |
|---|---|
| `GET /api/beta/sermons` | The founder's sermons |
| `POST /api/beta/sermons` | Start one (`title`, `preacher`, `permission: true`, `source`, `fileName`, `durationSec`) |
| `GET/PATCH/DELETE /api/beta/sermons/<id>` | Read; rename or mark research (`{ research: { question, marked } }`, only the sermon's own questions); delete |
| `POST /api/beta/sermons/<id>/pieces?index=n` | Transcribe the next WAV piece |
| `POST /api/beta/sermons/<id>/finish` | Find the passages and open the study |
| `POST /api/beta/sermons/<id>/study` | Write the study |
| `POST /api/beta/sermons/<id>/compare` | Compare `{ key }` with its context |

## Files

- `src/app/beta/study/sermons/` (hub and `[sermonId]` page)
- `src/app/api/beta/sermons/**`
- `src/components/beta/sermons/` (`SermonsHub`, `SermonCapture`, `audio.ts`, `SermonStudyView`, `ui.ts`)
- `src/lib/beta/sermons/` (`sermons-rules.ts` pure, `server.ts`, `http.ts`, `view-types.ts`)
- `tests/beta-sermons.test.mjs` (spoken references, quotation matching against
  the real bundled KJV, merging, the WAV and clock rules, the study and
  research guards)

## Reuse

- Voice messages: `BIBLE_TRANSCRIPTION_PROMPT`, the house key
  (`houseKeyFor`) and the AI SDK's `transcribe`.
- Sermon studies (`/sermons`, `SermonStudy`): the study's shape follows
  theirs (big idea, summary, timed sections with a verbatim pastor quote, a
  passage, SureWord's explanation labelled as such, a reflection), and the hub
  links to them.
- Learn a verse (`AddLearnButton`, `/api/learn`), the reader
  (`/bible/chapter`), `resolveReference`, the bundled KJV, and the shared
  study store.

## Proof

See LC-17643 on Linear: a production build on a Neon branch, signed in as the
founder stand-in, with the public-domain LibriVox reading of John Wesley's
"The Heavenly Treasure in Earthen Vessels" (12:51) uploaded through the real
page and a 40-second clip of it played into Chrome's microphone for the
recording path, at 1280 and at 375px with touch, light and dark, the
off-list account getting the ordinary 404 on every page and API route.

## Next

- Save a sermon into a Study Project, with the transcript as a source, once
  Study Projects (LC-17642) is on `main`; then this module goes `live`.
