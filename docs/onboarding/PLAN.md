# Walk with me: guided first run, led by SureWord

**Status:** Planned (2026-10-25). Not built. Prompted by Austin after walking a
church tester (Kim, FMBC) through the app by text: explaining SureWord took a
long message, and most people, many of them older, will never get that message.
The app has to explain itself, and SureWord itself should be the one doing it.

## What the data says (Neon, accounts created 2026-09-25 to 2026-10-25)

| | Of 25 new accounts |
|---|---|
| Never sent a message | 11 |
| Chatted at all | 14 (almost all tapped a suggested question) |
| Were asked an onboarding question by SureWord | 13 assistant replies asked one |
| Finished onboarding (`onboardedAt` set) | 1 |
| Have any saved memory | 2 |
| Read a chapter in the reader | 5 |

The "Getting to know you" interview (`docs/FEATURES.md`, shipped 2026-10-08) is
the right idea in the wrong place. It only runs after the person sends a first
message, and that message is nearly always a tapped starter question. SureWord
answers, then asks "what should I call you?" at the bottom of a long answer,
and people move on. Nothing in the app ever invites them to it, `/onboard` is
not in any menu, and every interview turn counts against the free daily cap.

The thing that makes SureWord different (it remembers you, knows your church,
and shapes each day's word to your walk) therefore never starts for almost
anyone.

## How a new person gets in today (Android, from the first-run map)

Splash, then "Welcome to SureWord" sign-in, then the AI consent sheet, then
(most likely, unconfirmed on device) the Chat tab, because every sign-in calls
`router.replace("/")`. Chat shows "Come hungry for the Word." and four question
tiles. Today, Bible, Study and Connections have no welcome or explanation at
all. There is no tour, coach mark, spotlight or first-time flag anywhere on any
client, and no app-wide text size setting (the reader's A-/A+ is not even kept
between launches). Web is the same shape, with guest mode in front.

## The idea

**SureWord greets you first, and walks you through your own app.** No slide
deck. The first thing a new person sees after the consent sheet is SureWord
speaking to them by name, in large text, with big tap-to-answer buttons, so
nobody has to type to get started. As the conversation reaches each part of the
app, SureWord lights that part up on screen (a soft gold glow and a short
caption in its voice), and the person can tap "Show me" to go there or "Later"
to keep talking.

It stays one experience on every client: the server runs the conversation and
decides what to show; each client only knows how to render the cards and how
to light up its own screens.

### Principles

1. **SureWord speaks first.** A new account opens on a welcome conversation that
   SureWord starts, not an empty composer. A real question still always gets a
   real answer first (the existing rule).
2. **Tap, don't type.** Every onboarding question offers big answer buttons
   (two to six choices, at least 56dp tall, full width) plus "Type my own" and
   the microphone. Older readers should be able to finish the whole thing with
   their thumb.
3. **Readable before anything else.** The very first card is text size:
   "Is this easy to read?" with three live previews (Standard, Large, Largest).
   The choice applies app-wide immediately and is saved to the account.
4. **Show, then tell.** When SureWord mentions a feature it calls a tool that
   lights it up on screen. Words alone do not teach "tap a verse"; a glowing
   verse that you tap does.
5. **Always free.** Onboarding turns and the guide's "how do I" answers never
   count against the free daily cap (their own usage surface, with its own
   abuse ceiling).
6. **Short and skippable.** About five minutes, one question at a time, "Skip
   for now" on every card, and it picks up later where it stopped. Never
   blocking: the tabs work the whole time.
7. **No gamification.** No confetti, XP or badges (same rule as Learn and Quiz).
   The reward is the first personalized word.

## The first run, step by step

Each step is a chat turn from SureWord with a card under it. Copy below is a
draft of the tone, not final.

1. **Welcome + text size.** "Welcome to SureWord. I'm here to walk with you in
   God's Word, wherever you are with Him. First, is this easy to read?"
   Card: three size previews. Saves `User.textScale`.
2. **Your name.** "What should I call you?" Prefilled button with the Clerk first
   name ("Call me Kim") plus "Something else".
3. **Where you are with God.** The existing six choices as big cards (pastor or
   preacher / serving in ministry / teacher or group leader / saved and growing /
   newly saved / still seeking). Seeking still outranks everything: the Gospel
   from Scripture comes before any tour.
4. **Your church.** "Do you have a home church?" Search card (existing
   `findChurch`), with a "Not right now" button. When the church has sermon
   studies (FMBC today), SureWord says so and lights up Study > Sermons.
5. **What's on your heart.** "Is there anything you'd like me to pray about with
   you, or anything you're walking through?" Free text or voice, "Not today".
   Saved as prayer memories, which already come back to them later.
6. **Your daily word.** "Every morning I can send you a verse and a short
   devotional made for where you are. What time works?" Time chips (6, 7, 8 am,
   noon, evening, "Pick a time"), then the system notification prompt right
   then, in context. Today's Pick Up Your Cross is generated on the spot and
   shown in the chat as the payoff.
7. **A quick look around.** "Want me to show you around? It takes a minute."
   If yes, SureWord walks the five tabs with the spotlight, one sentence each,
   ending with tapping a verse in the reader. If "Later", the Getting started
   card on Today holds the same steps.
8. **Finish.** A short warm summary of what it now knows, the About me offer
   (existing), `finishOnboarding`, and one next step.

### The spotlight ("glow")

- A dim layer over the screen with a cutout around the target, a slow gold
  pulse ring (the logo's gold), and a caption bubble in SureWord's voice with
  "Show me" / "Next" / "Done". Respects reduce-motion (static ring, no pulse).
- Targets are named, not positioned: each client registers elements under
  stable keys (`tab.today`, `tab.bible`, `today.cross`, `today.learn`,
  `today.plan`, `reader.verse`, `reader.listen`, `study.sermons`,
  `study.notes`, `connections.map`, `settings.church`, `chat.mic`, ...). A key
  a client cannot show is skipped silently.
- Android: a small in-house overlay on Reanimated 4 (already a dependency) plus
  `measureInWindow` on registered refs. The 2026-09-02 pick
  (`@wrack/react-native-tour-guide`) is optional; in-house keeps it under our
  control for the chat-driven case.
- Web: the same registry with a portal overlay and CSS (the unused
  `.animate-pulse-glow` in `globals.css` is the starting point). NextStepjs was
  the 2026-09-02 pick and still fits if we want cross-route tours.
- Apple: a SwiftUI overlay with `anchorPreference`, same keys, later in the
  cycle per the parity rule.

### SureWord can show you anything, any time

Onboarding is only the first use. Two server tools make the guide permanent:

- `showInApp({ target, caption, navigate })`: renders as a "Show me" card in the
  chat; tapping it navigates (receipt-route style, which already exists) and
  plays the spotlight on arrival. The model gets the target list and one-line
  descriptions from the existing `appKnowledge` block.
- `presentChoices({ question, options, allowOther })`: the big answer buttons.
  The tapped label is sent back as the user's message, so the transcript reads
  naturally and every client can render it.

So "how do I highlight a verse?" or "where's my reading plan?" gets a short
answer plus a glowing "Show me", from any screen, forever. A small "?" in each
screen header opens chat already knowing which screen you were on
("Help me with the Bible reader").

### Getting started card (Today)

For anyone who skipped the tour or wants it later: one card at the top of
Today with five rows (Read a chapter, Tap a verse, Your daily word, Learn a
verse, Your church), each ticked by real use (reading events, insight opens,
cross opened, VerseMemory row, UserChurch row). Tapping a row asks SureWord
about it with the spotlight. The card disappears for good once done or
dismissed. Nothing ticks itself.

## Server and data changes

- `User.textScale` (`standard` | `large` | `largest`) in account preferences,
  applied app-wide on every client (Android multiplies its typography scale;
  web sets a root font-size class; Apple maps to Dynamic Type).
- `POST /api/onboarding/start`: idempotent; creates (or returns) the welcome
  conversation with SureWord's first message for accounts with `onboardedAt`
  null, so the client opens straight into it. Existing members never see it
  unless they ask ("Walk me through SureWord" in Settings and the chat menu,
  which also replaces typing `/onboard`).
- Usage: an `onboarding` surface excluded from the 20/day free count while
  `onboardedAt` is null or the conversation is the onboarding one; separate
  ceiling (e.g. 60 turns per account) so it cannot be farmed.
- Tools: `presentChoices`, `showInApp`; the onboarding guidance gains the
  step order above and calls them.
- Sign-in lands new accounts on the welcome conversation instead of whatever
  `/` happens to be; returning users keep today's landing.
- PostHog funnel (no study content, per the existing rule): welcome shown,
  each step answered or skipped, tour started/finished, first chapter read,
  first cross opened, day-7 return.

## Order of work (Android first, parity in the same cycle)

1. **Server**: start route, usage exemption, `presentChoices` + `showInApp`
   tools, revised guidance, `textScale` preference. Ships to every client at
   once and is useful even before the spotlight exists (cards render as
   buttons and links).
2. **Android**: text size app-wide, welcome conversation on first sign-in,
   choice and "Show me" cards, the spotlight overlay and target registry,
   Getting started card. Prove on the emulator with a fresh account.
3. **Web**: same cards, spotlight and registry, plus the guest flow handing
   straight into the welcome after sign-up.
4. **macOS / iOS**: cards first, spotlight second, on a Mac runner.

## Decisions (Austin, 2026-10-25)

These were the open decisions; Austin settled all four before the build.

1. **Landing: decided.** A brand-new account (`onboardedAt` null and no
   earlier conversations of its own) lands in the welcome conversation on Chat,
   after sign-in and after the AI consent sheet. Returning accounts keep
   today's landing.
2. **Voice: decided.** "Read it to me" is optional and off by default. When it
   is on, every SureWord message in the welcome is read aloud. It can be
   switched at any point and is saved to the account (`User.voiceMode`). It is
   free during onboarding and uses the Listen narrator (ElevenLabs,
   `ELEVENLABS_VOICE_ID`). Cost controls: the fixed scripted lines are
   generated once and cached for every account; dynamic replies are generated
   only when they are about to be read; each account has a character ceiling
   (`ONBOARDING_VOICE_CHAR_CEILING`, default 12,000) and there is an env kill
   switch (`ONBOARDING_ELEVENLABS_DISABLED=true`). Past the ceiling, with the switch off, or on any failure, the client
   falls back to on-device speech (expo-speech on Android, Web Speech on web,
   AVSpeechSynthesizer on Apple).
3. **Existing members: decided.** The welcome is for new sign-ups only. It is
   never pushed, and no card is shown, to existing accounts that never
   finished onboarding. A quiet "Walk me through SureWord" row in Settings
   replaces typing /onboard, for anyone who wants it.
4. **Free ceiling: decided.** Welcome turns are exempt from the 20 a day free
   cap and have their own per-account ceiling (`ONBOARDING_TURN_CEILING`,
   default 60), which must stay at least twice the chattiest measured run.
   Reaching it falls back to the normal free cap with a kind message and never
   dead-ends anyone.

## Acceptance

- A brand-new Android account, using only taps, sets text size, name, faith,
  church, prayer and daily time, gets its first personalized word, and sees
  each tab lit up once, in under five minutes, without hitting any limit.
- The same account on web resumes where Android stopped.
- After finishing, `onboardedAt` is set, the memories and church show in
  Settings, and the Getting started card reflects what was really done.
- Reduce-motion and the Largest text size both work on every onboarding card
  and spotlight caption.
