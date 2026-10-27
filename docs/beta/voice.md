# Voice Study (`voice`)

*Live in SureWord Beta since 2026-10-26 · LC-17653 · web only · `/beta/study/voice`*

A hands-free spoken conversation about Scripture. The founder taps **Start
talking**, asks a question out loud and talks it through: talking over an
answer stops it, "say that another way" gets a fresh explanation, and "read
me Romans 5" plays the passage from SureWord's narrated King James Bible. A
live transcript shows both sides and links every passage SureWord names, and
each conversation is kept and can be saved as a Note.

## How it works

```
browser mic ──WebRTC──> OpenAI Realtime (gpt-realtime-2.1)  ──speech──> browser speaker
   │  offer SDP                ▲   data channel: transcripts, tool calls
   ▼                           │
POST /api/beta/voice/call ─────┘ (server adds key, instructions, tools; returns the SDP answer)
POST /api/beta/voice/tool  ← the browser relays each tool call; the server runs it
GET  /api/bible/audio      ← readScripture plays the narrated KJV chapter MP3
```

- **Model.** `gpt-realtime-2.1` (speech to speech, `reasoning.effort: "low"`,
  voice `cedar`) with live input transcription by `gpt-live-transcribe`.
  Verified on 2026-10-26 against developers.openai.com and a live
  `client_secrets` probe (an invalid effort is refused with the five valid
  values). Not chosen: `gpt-4o-mini-tts` and `tts-1` (deprecated, shut down
  2027-01-06) and `gpt-4o-mini-transcribe` (shuts down 2027-02-26), which is
  why a "transcribe, answer, speak" chain on the old endpoints was ruled out.
  Same provider and house key SureWord already uses; no new account.
- **No key in the browser.** The browser posts its WebRTC offer to
  `/api/beta/voice/call`, which calls OpenAI's `POST /v1/realtime/calls` (the
  "unified interface") with the server's `OPENAI_API_KEY`, the session
  instructions and tools, and a hashed `OpenAI-Safety-Identifier`. The browser
  gets back only the SDP answer: no key, not even an ephemeral one.
- **Grounding.** The instructions are SureWord's pastor-written doctrinal
  foundation, pastoral care, interpretation and trusted-context guidance (the
  same blocks chat and tap-a-verse use, from `src/utils/systemPrompt.ts`;
  chat's "quote the exact text" rule is left out on purpose, because nothing
  filters speech-to-speech audio), then a voice section
  (`src/lib/beta/voice/prompt.ts`). The tools are chat's own Scripture tools
  from `buildSureWordTools`: `searchScripture`, `findVerses`, `getPassage`,
  `getCrossReferences`, run on the server by `/api/beta/voice/tool` with their
  own schemas and exact KJV text, plus `recallStudy` (below).
- **Scripture is never synthesized.** The model is told never to read or
  recite a verse. When a passage should be heard it calls `readScripture`, which
  the browser answers itself: the server resolves the passage
  (`planVoiceReading`: one chapter, or a range inside one chapter, with the
  exact KJV for the screen), the browser fetches the chapter's recording and
  verse timings from the Audio Bible (`GET /api/bible/audio`) and plays
  exactly those verses (`narrationClip`), highlighting the verse being read. If a
  chapter had no recording, the words are shown and the model is told not to
  read them.
- **Picking up past study (LC-17724).** "Can we continue our conversation
  about James?" makes the model call `recallStudy` with the passage or topic
  as it was said. The server (`src/lib/beta/voice/recall.ts`) reads the
  founder's own study through the Knowledge Vault's study memory,
  `vaultTimeline` (notes, highlights, chat turns, reading, Learn a verse,
  memories, sermon studies and every beta item, earlier Voice Study
  conversations included; a topic is also found by meaning), never a second
  index. Private items (`data.private: true`) are dropped whole before
  anything is sent, and like the Vault's Ask it runs only for an account that
  has agreed to AI. The model gets the newest eight entries, each dated, plus
  the closing turns of the newest Voice Study conversation on the subject
  (`studyRecallOutput`), and recaps what was last discussed, then asks where
  to pick up. "Quiz me" and "help me prepare questions for my pastor" work on
  the same recalled study. Nothing found comes back as `nothing_yet`, and the
  model says so plainly instead of inventing a memory; entries found only by
  meaning are marked, so a loose match is not taken for real study. The tool
  route logs the status, a passage subject (never a topic's words) and the
  count, never the study itself.
- **Barge-in.** While SureWord speaks, semantic VAD cancels the reply the
  moment the founder talks; over WebRTC the API drops the unheard audio from
  the conversation (`output_audio_buffer.cleared`), and the transcript marks
  that answer *Interrupted*. While the narration plays, the session is told
  not to answer on its own. The recording pauses at the first sound of
  speech; when the words are transcribed it either resumes (the recording
  leaking back into the microphone, `isLikelyNarrationEcho`) or stops and
  hands the words to SureWord with where the reading stopped.
- **Microphone.** Asked for only by the Start tap. A microphone the browser
  has already blocked (Permissions API) is explained before anything is
  attempted, with steps for Chrome and Safari; missing, busy, unsupported and
  insecure-page cases each have their own message.
- **Safari.** Everything is done inside the start tap that iOS requires
  (audio elements primed with a silent clip, `AudioContext` resumed, then
  `getUserMedia`); playback afterwards is allowed because the page is
  capturing. Chrome is proven below; Safari has not been run (see Proof).

## Data

- **`BetaItem`, module `voice`, kind `session`**, one per conversation, through
  `src/lib/beta/store.ts`. `title` is the first question, `body` the plain
  transcript ("You: ... / SureWord: ... / Read aloud: Romans 5:1-5"), `refs`
  every passage cited or read, `topics` `["voice study"]`. `data` (validated
  by `checkVoiceTurns`): `version`, `turns` (`user`, `assistant`, `reading`
  with the reference only, `interrupted`), `startedAt`, `endedAt`,
  `durationSeconds`, `usage` (token counts from every `response.done`,
  transcription seconds), `costUsd` (list-price estimate), and once saved
  `noteId`, `noteTurnCount`, `notePassages`.
- **Note.** "Save as note" (during or after a conversation, or from Recent
  conversations) writes a `Note` titled "Voice Study: <question>" through
  `appendMarkdownToNote`: the transcript, then each passage cited or read,
  quoted in full from the bundled KJV in the house blockquote shape, never
  from the model. Saving again after more conversation appends only the new
  part under "Continued", so the founder's own edits are never overwritten.
  Forgetting a conversation leaves its Note.
- Kept automatically when the conversation ends (End, 3 quiet minutes, the
  30 minute limit, a dropped connection, or leaving the page), but only when
  something was asked and answered. No new table, no migration.

## Spend

Billed per token by OpenAI only while a conversation is open (input audio 1
token per 100 ms of speech, output audio 1 per 50 ms; silence is not billed),
plus $0.017 a minute of transcribed speech. A conversation ends itself after
3 minutes with nobody speaking and nothing playing, and after 30 minutes
(both enforced by the page; OpenAI's own 60 minute session limit is the
server-side backstop). Opening calls is limited to 20 an hour per founder by
the in-memory limiter in `src/lib/rateLimit.ts`, which counts per server
instance, so it is a brake rather than a hard cap. Measured on the proof
runs: about $0.17 for a 2.5 minute conversation with two tool rounds, a
reading and two interruptions (each session's `costUsd`).

## Files

- Page: `src/app/beta/study/voice/page.tsx`
- Components: `src/components/beta/voice/` (`VoiceStudy`, `VoiceTranscript`,
  `VoiceSessions`, `useVoiceStudy`, `voiceEngine`)
- Logic: `src/lib/beta/voice/` (`voice-rules.ts` pure, `prompt.ts`,
  `session.ts`, `tools.ts`, `sessions.ts`, `recall.ts`)
- API: `src/app/api/beta/voice/{call,tool,sessions,sessions/[id],sessions/[id]/note}/route.ts`,
  all gated by `requireBetaApi()`
- Tests: `tests/beta-voice.test.mjs`

## Proof (2026-10-26)

A production build against a throwaway Neon branch, signed in as the founder
stand-in with a Clerk sign-in token, driven by Puppeteer with Chrome's fake
media stream playing one recorded WAV: the question "What does Romans chapter
five teach about having peace with God?", "Hold on. Can you say that another
way, more simply?" while the answer was playing, "Now read me Romans chapter
five, verses one through five", and "Stop there. What does it mean to be
justified?" during the reading. Each run checked transcription of all four,
the chat tools grounding the answer, the first spoken audio about 1 s after
the question ended, the cut-off answer marked Interrupted, the Romans 5 MP3
playing from verse 1 with the verse highlight following, the reading stopping
at verse 3 and the answer that followed, the session kept, and a Note saved
with the passages. Run at 1280 and at 375 px with touch. The off-list account
gets the ordinary 404 on the page and on every voice API route; signed out,
the page redirects to sign-in and the API answers 401. A blocked microphone
shows its explanation without asking. Not run: Safari (no WebKit with a fake
microphone on the proof host); iOS output routing and echo on a phone
speaker are the things to watch when a founder first uses it there.
