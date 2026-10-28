# SureWord for Android - Changelog

This file is the **single source of truth for Google Play "What's new" release notes** and for what shipped in each Android build. `push-phone.sh` reads the Play text straight from here (via `scripts/play-notes.mjs`) and **refuses to publish without it** - release notes are never typed ad hoc or invented at publish time. GitHub Releases (`release-apk.sh`) point here too.

## 1.108.1 (versionCode 127) - 2026-10-28 - internal and closed testing

**What's new (Play):**

FIXED
- After the "Tap a verse" step of Getting started, the Bible tab no longer gets stuck on John 3. Back now takes you to the Bible home so you can open any book and chapter.

**Dev notes:** Austin's recording (2026-10-28): "Show me" on the Tap a verse step called `router.navigate` to `/bible/chapter?book=43&chapter=3&verse=16` without an anchor while the Bible tab had never been opened, so the Bible stack held only that chapter. System Back and the reader's back arrow left the tab, and every return to Bible landed on John 3 again. Fix: every spotlight navigation passes `SPOTLIGHT_NAVIGATION_OPTIONS` (`withAnchor: true`, the same option the Today and notification links already use), and the reader opens its stack's home (Bible, Today or Study) in place of itself when Back is pressed with nothing beneath it, so no future link can strand it either. No native changes.

## 1.108.0 (versionCode 126) - 2026-10-28 - internal and closed testing

**What's new (Play):**

IMPROVED
- Listen to the daily devotional is now part of every SureWord Pro membership.
- When Free reaches a Pro feature or today's message limit, a See SureWord Pro button takes you straight to Membership.

**Dev notes:** Austin's Free/Pro rulings (2026-10-28). Server (33058edd): `listenAccess` gives Listen to every Pro account with no env switch; `SERVER_CREDENTIAL_USER_IDS` is Austin only, so the owner picker and GPT-6.1 Sol are his alone; owner utility on Luna. Upgrade paths (c47f2f7c): the allowance 429 body carries `plan` (`includedLimitBody`), Android ListenCard and chat ErrorCard show "See SureWord Pro" (opens Settings -> AI Membership) only when `canOfferPlayUpgrade` says Play checkout is available and the reader is Free (`usePlayUpgrade`, fetched only while a wall shows). Web links to /membership; iOS opens ProMembershipView; iOS voice-quota copy names Pro while App Store checkout is available (`mentionsProFor`). Google Play RTDN wired (versemind-auth Pub/Sub push, verified 200). No native changes.

## 1.107.0 (versionCode 125) - 2026-10-27 - internal and closed testing

**What's new (Play):**

IMPROVED
- Membership now shows your renewal date, a notice if your subscription is ending, and a message if a payment failed.
- When you have used today's messages, SureWord says so plainly and tells you when more are available in your own time, instead of saying you are going too fast.

**Dev notes:** Free/Pro audit (2026-10-27). Android: `src/features/settings/membershipView.ts` (pure, tested) drives the Membership card's period end, cancel and lapse notice, failed-payment line and a plain-text note on where an App Store or web subscription is managed (no cross-store link, per Play policy); `src/features/chat/chatErrors.ts` maps the server's daily-allowance 429 to "You've used today's messages" with the reset in local time instead of the raw UTC timestamp under "Too many requests". Server changes shipped to main the same day and reach every client: Pro and the owner's Pro pick stay on high effort when chat sends a stale stored effort (`includedEffortFor`), App Store REFUND_REVERSED reinstates Pro, and the Listen gate is a tested rule (`listenAccess`). Web: `/membership` links App Store subscribers to the App Store instead of the Stripe portal, owner picker hides search. No native changes.

## 1.106.1 (versionCode 124) - 2026-10-27 - internal and closed testing

**What's new (Play):**

FIXED
- Ways to Serve: the keyboard no longer covers the What I did journal or the nearby search box while you type.

**Dev notes:** `src/features/serve/ServeScreen.tsx` wraps its ScrollView in `KeyboardAvoidingView` (behavior padding, the notes editor's pattern), and focusing the journal or location input scrolls that section back into view once `keyboardDidShow` fires, since Android never scrolls a ScrollView to a focused input. No native changes.

## 1.106.0 (versionCode 123) - 2026-10-27 - internal and closed testing

**What's new (Play):**

NEW
- Ways to Serve: free, optional ways to let God's love reach someone, online or near you, each with a verse. Serving never saves; we are saved by grace through faith (Ephesians 2:8-10).
- Choose Off, Nearby, Online or Both. Tell SureWord you already give to your church and it never asks you to give there.
- What I did: a private journal of moments God gave you to love someone, never counted.
- Open it from Today or Settings.

**Dev notes:** Ways to Serve (GitHub issue #28, 2026-10-27). Server: `src/lib/serve-rules.ts` (hand-written ways with KJV verses, `pickToday` stable per reader per day, giving never today's way for someone who gives to their church), `src/lib/serve.ts`, `/api/serve`, `/api/serve/nearby` (Places text search near a typed city or ZIP, never GPS), `/api/serve/journal`, chat tools in `src/lib/serve-tools.ts`, migration `20261027220000_ways_to_serve` (applied to production 2026-10-27). Android: `src/features/serve/*` (parser, action mapping, shared `useServe` store, `ServeScreen`), routes `today/serve` and `settings/serve`, Today row and Settings STUDY row, chat activity labels. No native changes.

## 1.105.0 (versionCode 122) - 2026-10-27 - internal and closed testing

**What's new (Play):**

IMPROVED
- Adjust text with clear smaller, larger and reset buttons in Appearance & reading. Standard, Large and Largest keep text within a comfortable range.
- Text size now reaches more of the app, including Scripture, notes and the message box. Navigation and controls make room for larger text.

**Dev notes:** Accessibility sizing uses the existing account preference and its bounded 1 / 1.15 / 1.3 factors. Reader-specific sizing is preserved and the app factor applies once to native text runs, Markdown, the paste-enabled composer and the rich notes editor. The text controls disable at their limits and reset to Standard. Cross-client implementation and actual verification receipts are recorded in docs/accessibility-text-size-2026-10-27.md and docs/PARITY.md. App package versions are synchronized for this release.

## 1.104.0 (versionCode 121) - 2026-10-26 - internal and closed testing

**What's new (Play):**

NEW
- Getting to know you now asks whether you have been saved. Tap the word "saved" to read what it means, straight from the King James Bible.
- SureWord now asks how long you have walked with the Lord, and invites you to share your testimony in your own words.

IMPROVED
- The welcome explains why it asks: every answer, every prayer and each morning's verse is shaped by what you share.
- Each welcome message ends with one card, never two.

**Dev notes:** Walk with me audit from production data (2026-10-26). Server, shared by every client: `walk` and `testimony` steps after `faith` in `src/lib/onboarding-rules.ts` (the newly saved skip walk, seekers skip both, testimony skipped when one exists), faith question "have you been saved?" with `terms: ["saved"]` and the fixed `GLOSSARY.saved` text (KJV quotes checked word for word against `src/data/kjv` in `tests/onboarding-rules.test.mjs`), new `WELCOME_TEXT`, `hasToolCall("presentChoices")` in the chat route's `stopWhen` (the doubled sentences and double cards), the faith answer filed as a profile memory and never as prayer, testimony card answers saved by `saveTestimony` without a second yes. Welcome eligibility now goes by sign-up date (`WALK_WITH_ME_LAUNCHED_AT`, `isNewSignUp`), so a new account that chatted first on an older build still gets the welcome after updating, and until then an ordinary chat on a pre-1.101 build runs the interview in words (`needsTextInterview`, `textInterviewGuidance`). Android: underlined "saved" in `ChoiceCard` opens `GlossarySheet` (BottomSheet primitive); its Talk with SureWord button sends the question through the new `ask` action and tracks `onboarding_step` outcome `asked`. `chatView.parseChoiceCard` reads `terms`. The new steps need no client code (unknown steps already draw generically). No native changes.

## 1.103.0 (versionCode 120) - 2026-10-26 - internal and closed testing

**What's new (Play):**

NEW
- SureWord now answers in Spanish and German. It follows your phone's language, or choose one in Settings, Language.
- Two more Bibles, free and offline: the Reina-Valera 1909 (Español) and the Lutherbibel 1912 (Deutsch).
- Bible references in Spanish and German answers, like Juan 3:16 or Johannes 3:16, open in the reader.

**Dev notes:** Plan and contract in `docs/languages/PLAN.md` ("Implementation contract"), feature notes in `docs/FEATURES.md` ("Spanish and German: Bibles and answers"). Server: migration `20261026120000_answer_language` (applied to production 2026-10-26 through the Neon MCP), `answerLanguage` in the preferences document, `/api/ask-question` reads `language` and quotes `quotationTranslation()`, `languageGuidance` in the chat prompt, verse insight explains in the Bible's language. Android: bundled RV1909 and LUT1912 JSON per book (`src/features/bible/data/{rv1909,lut1912}`), `TRANSLATION_IDS`/`parseTranslationId` replace every hard-coded KJV/NKJV/BSB check, Settings, Language (`app/(app)/settings/language.tsx`, `answerLanguage.ts`, `effectiveLanguage.ts` on expo-localization, already a dependency), `language` sent with chat and verse insight, Spanish and German book names in `books.ts` and `verseLinks.ts` (parity sweep in `tests/verse-parity.test.mjs`). No new native dependency. Menus stay English (Layer 3 not built).

## 1.102.0 (versionCode 119) - 2026-10-25 - internal and closed testing

**What's new (Play):**

NEW
- One name for SureWord's AI on every plan: SureWord AI. With SureWord Pro, the gold day star beside the name shows you are on Pro's deeper thinking.
- The AI you are using now shows above the message box. Tap it to see your plan.

CHANGED
- Bring-your-own API keys are gone: every account is Free or Pro.

**Dev notes:** Android parity for cf9595f0 and 5e7a15d7 plus the no-BYOK direction (Austin, 2026-10-25: no model picker for regular users, Free and Pro are both "SureWord AI" on GPT-6 Luna, low and high effort, and the web picker is the design for every platform). `GET /api/ai/models` sends `premium` on the house block and model rows (absent on older servers, read as false). The payload now loads once on the chat screen (`useAiModels`) and feeds both the new composer model chip in `ChatInputBar` (sparkles + label, or the premium mark in place of the sparkles for Pro; `composerChip`) and `ModelPickerSheet`. The sheet draws `assets/chat-home/sureword-mark.png` (`PremiumMark`, tinted `colors.accent`) after a premium label and before its pills, which now sit on the label line as on web; screen readers hear "Pro". House mode is the single "SureWord AI" row and nothing else (the note and the add-a-key row are gone). The owner's two plan rows (`sureword/free`, `sureword/pro`) render under one static "SureWord" header in a content-sized sheet with no search and no Options tab (`ownerPlansOnly`). BYOK removed from the client: `ProviderSettingsSection.tsx` deleted, the API KEYS section left Settings > AI, the hub's AI subtitle no longer counts keys, the providers slice left `settingsData.ts` (no client calls `/api/providers` any more), and Membership shows only the plan (the Included AI / My API key choice is gone). The consent text change is the Apple lane's commit. No native changes.

## 1.101.0 (versionCode 118) - 2026-10-25 - internal and closed testing

**What's new (Play):**

NEW
- Walk with me: new accounts are welcomed by SureWord with big tap-to-answer cards, so you can set up without typing: text size, your name, your church, a prayer request and a daily time. Then SureWord lights up each part of the app with a gold spotlight.
- Read it to me: turn it on in the welcome to hear each message aloud.
- Text size: Standard, Large or Largest, in Settings, Appearance.
- A "?" on each screen asks SureWord how it works, and Settings has "Walk me through SureWord".

**Dev notes:** Plan and Austin's four decisions in `docs/onboarding/PLAN.md`; architecture in `docs/FEATURES.md` under "Walk with me". Server (868e1bec, migration `20261025150000_walk_with_me` applied to production): `POST /api/onboarding/start` (auto for brand-new accounts only, manual from Settings), `GET/PATCH /api/onboarding/progress`, `POST /api/onboarding/audio` + `/stream`, the `presentChoices` and `showInApp` tools, the `onboarding` usage surface and turn ceiling, `textScale` and `voiceMode` in the preferences document. Android: `src/features/onboarding/` (byte copy of `src/lib/onboarding-rules.ts`, checked by `tests/onboarding-rules.test.mjs`; ChoiceCard, ShowMeCard, the Reanimated spotlight with `SpotlightAnchor` + `measureInWindow` in a transparent Modal, `useWelcomeVoice` on expo-audio with expo-speech as the free fallback, WelcomeLauncher after the consent sheet, GettingStartedCard on Today), `AppText` scaling by `textScale`, the Read it to me bar in the welcome only, header "?" buttons that open a fresh chat, and anchors on the tabs, Today, Study, Settings, the composer and the reader's verse. New native dependency: `expo-speech` (~57.0.3), so this build needs a prebuild. Fixes from the production proof runs (three brand-new accounts on the emulator, signed up through mail.tm): the spotlight reveals an off-screen target whenever a measurement finds it there, because an already-mounted tab is first measured from stale layout (`SpotlightScrollView` on Today, Study and the Settings sub screens); WelcomeLauncher re-checks when a dependency changes mid-request, instead of leaving the launch marked as checked; the church step saves through a plain yes and inherits the matched church's YouTube channel (3f544429, e366db71). Metering: a tap-only run is 8 onboarding turns and the chattiest typed run was 16, so the ceiling of 60 is more than 3x; the ceiling counts every reservation, because a turn that ends on a card settles as "failed" (12 of 21 production rows). Read it to me bills 1,281 to 1,643 reply characters per account on eleven_flash_v2_5; the scripted lines are narrated once and shared.
## 1.100.1 (versionCode 117) - 2026-10-25 - internal and closed testing

**What's new (Play):**

FIXED
- Quiz me keeps the question on screen after you answer. The verse card now slides up from the bottom instead of pushing the question off the top.

**Dev notes:** Found in the 1.100.0 emulator proof: after Check answer, `QuizScreen` scrolled the verse card to the top of the column (`scrollTo(cardY - spacing.xl)`), so on a phone the prompt was cut off. The card is the last item in the column, so it now uses `scrollToEnd`, the least movement that shows it. The Apple quiz gets the same fix (`proxy.scrollTo("verse", anchor: .bottom)`); web already used `scrollIntoView({ block: "nearest" })`. No native changes.

## 1.100.0 (versionCode 116) - 2026-10-25 - internal and closed testing

**What's new (Play):**

NEW
- Quiz me: at the end of any chapter, take a short 5 question quiz on what you just read. Every answer comes with its verse, misses can go straight into Learn, and a closing reflection saves as a note. Free and always optional; turn the offer off in Settings, Appearance.

**Dev notes:** Suggested by the closed-testing coordinator (2026-10-23). Plan and mockups in `docs/quiz/PLAN.md`; architecture in `docs/FEATURES.md` under "Quiz me". Server: `POST /api/quiz` (consent `tap`, included AI request) writes eight drafts from the whole KJV chapter and keeps only questions whose right answer the cited verse actually says (`src/lib/quiz-rules.ts`), cached per chapter and depth in `QuizBank`; `POST /api/quiz/attempt` records `QuizAttempt` rows (migration `20261025120000_chapter_quiz`, applied to production). Android: `src/features/quiz/` (contract mirror, view model with tests, `useChapterQuiz`, screen, results, offer card), the `quiz` route in the bible stack with today/study re-exports, the offer card in the reader's list footer keyed on the chapter, the device-only `quizOffer` setting (default on, survives an account switch, never synced), "Not now" remembered per chapter on the device (200 at most), and Learn source `quiz`. Ask about this prefills the composer through the reader's existing Ask path. No native changes.

## 1.99.1 (versionCode 115) - 2026-10-23 - internal and closed testing

**What's new (Play):**

FIXED
- Signing in no longer runs twice when you press Enter, which could show an error after you were already in.
- The Back button now steps back through sign-in instead of closing the app.
- Choosing "Use a different email" clears the password you typed for the last one.
- Listen, share cards and Add to calendar no longer spin forever when the phone starts offline.
- Deleting your account now cancels a Google Play subscription for you, and reminds you to cancel an App Store one.

**Dev notes:** Bug hunt 2026-10-23 (Linear LC-17258; LC-17259, LC-17261, LC-17266, LC-17267, LC-17273, LC-17275). Account deletion: the server now cancels Google Play renewal before deleting (and refuses with 503, nothing removed, if Google cannot be reached); App Store subscriptions cannot be cancelled server-side, so the first confirmation shows `DELETE_APP_STORE_NOTICE`, word for word the web and Apple copy. PostHog showed `sign_in_completed` followed 0.4 to 1 s later by `sign_in_failed` (unknown, resource_not_found, authentication_invalid) and overlapping Google SSO starts, because no handler guarded re-entry and every `onSubmitEditing` still fired under the spinner. `singleFlight()` in `src/features/auth/authErrors.ts` now gates every submit (button, Enter, Google, resend), and `sign_in_completed` is tracked only after `setActive` resolves. Non-Clerk failures report a content-free class (`network`, `aborted`, `exception_<Name>`) instead of `unknown`. Hardware Back uses `previousAuthStep()` through a focused `BackHandler`. `boundedToken` in `src/lib/api.ts` is exported and now caps the Listen stream, share-card and calendar token mints at 15 s. The Google failure copy no longer names a Back button the welcome step does not have. No native changes.

## 1.99.0 (versionCode 114) - 2026-10-22 - internal and closed testing

**What's new (Play):**

NEW
- Create an account right in the app with your email and a password. The first screen now offers Create an account and Sign in, with Continue with Google under both.

FIXED
- Signing in with an email that has no account now offers to create one instead of stopping at "couldn't find your account".
- Google sign-in no longer returns you to the sign-in screen without saying why. If something is missing, it tells you what to do next.

**Dev notes:** Closed-testing feedback (2026-10-22): testers could not get past sign-in. PostHog for the 1.98.0 tester cohort showed 7 people hitting `form_identifier_not_found` on the email field (the app had no sign-up path at all, only `signIn.create`) and Google ending 86 times with no session, every one of them recorded as "abandoned" and shown as nothing. `app/(auth)/sign-in.tsx` is now a step machine: welcome (Create an account / Sign in / Google), sign-in email, password, code, sign-up (email + password via legacy `useSignUp`, then the emailed `email_code` through `prepareEmailAddressVerification`/`attemptEmailAddressVerification`). Google now separates a real cancel (`abandoned`) from `useSSO` returning before the browser opened (`not_loaded`) and from Clerk returning without a session (`incomplete_<status>`, with the missing fields shown). `session_exists` goes straight in instead of showing an error. Pure helpers and tests in `src/features/auth/authErrors.ts`. Sign-up analytics reuse the `sign_in_*` events with `method: email_signup`, so the server event mirror is unchanged. No native changes.

## 1.98.0 (versionCode 113) - 2026-10-20 - internal and closed testing

**What's new (Play):**

NEW
- What's new: every SureWord update in one place, newest first, with search and filters. Open it from Settings.
- After an update, a short "Since you were last here" card shows what changed, with a Try it button for each new feature.
- The same release notes are on the web at sureword.app/whats-new.

**Dev notes:** Release notes overhaul. `scripts/sync-whats-new.mjs` turns the Play blocks of this file into `src/content/whats-new/releases.json` (Dev notes are never published; tests/whats-new.test.mjs fails if a Dev note leaks or the JSON is stale), joined with the hand-written `editorial.json`. Public, cached `GET /api/whats-new`; authed `GET/POST /api/whats-new/catch-up` backed by the new `User.whatsNewSeenCode` column (migration 20261020120000_whats_new_seen). A new account is seeded to the newest release so it never sees a backlog, the seen value only moves forward, and `?upTo=<versionCode>` keeps a phone from being told about a build it has not installed. Android: Settings -> What's new (`app/(app)/settings/whats-new.tsx`) and `features/whatsNew/WhatsNewPresenter.tsx`, mounted after the AI consent sheet. No native changes.

## 1.97.1 (versionCode 112) - 2026-10-19 - internal and closed testing

**What's new (Play):**

IMPROVED
- Today keeps longer verse previews compact so Read today's word stays easy to reach. Open the devotional for the full passage and reflection.
- Includes the new Today, Bible, Chat, Connections and Study navigation, with Notes in Study and clearer Back behavior.

**Dev notes:** Live 375-pixel verification with a longer existing daily verse showed the primary button overlapping the fixed dock on the initial viewport. The home preview is limited to three visible lines across clients; full Scripture remains available in the existing devotional, with no text changes or extra AI request.

## 1.97.0 (versionCode 111) - 2026-10-19 - internal and closed testing

**What's new (Play):**

NEW
- Today brings your daily word, reading plan and verse practice together.
- Five clear tabs: Today, Bible, Chat, Connections and Study.
- Bible opens straight into reading. Find Notes, the timeline, atlas and sermon studies in Study.
- Existing verse, devotional and note links keep working with clearer navigation and Back behavior.

**Dev notes:** Daily Walk navigation overhaul. Today uses an authenticated, read-only devotional preview, so opening home never generates or replaces a word. Daily and study screens have separate anchored stacks with compatibility routes for existing links. Compact local dawn artwork and native icons support dark and light appearance. Android release proof and cross-client status are recorded in docs/navigation-overhaul.md.

## 1.96.0 (versionCode 110) - 2026-10-19 - internal and closed testing

**What's new (Play):**

NEW
- Connections: a new tab that shows how Scripture is woven together, every book on one ring with a chapter's cross-references drawn across it.
- Tap a verse to see its connected verses, tagged by part of the Bible, and filter by section.
- Ask why these connect: a short explanation of how each passage ties to your verse.
- Open it from the map button in the reader or from See also on any verse.

**Dev notes:** Fourth primary tab `mobile/app/(app)/connections.tsx` (PRIMARY_TAB_ROUTES now index, bible, connections, notes). Ring drawn with react-native-svg in `mobile/src/features/connections/ConnectionsRing.tsx`, chords batched one path per colour; geometry, palette and the explain parser in `connectionsMap.ts`, byte-identical with `src/lib/bible/connectionsMap.ts` (tests/connections-map.test.mjs). Data from new public, edge-cached `GET /api/bible/connections` and `/api/bible/connections/overview`; the explain sheet streams `POST /api/bible/connections/explain` (session, consent tap, included AI request, cached in VerseInsight). Reader: network button in the header and a "See every connection on the map" link under See also, both via router.navigate with a nonce. No native changes.

## 1.95.0 (versionCode 109) - 2026-10-18 - internal and closed testing

**What's new (Play):**

IMPROVED
- Starting SureWord without a connection no longer leaves Settings switches and requests stuck after you come back online.
- If a screen hits a problem, you now get a Try again button instead of the app closing.
- A reply whose formatting cannot be drawn now shows as plain text instead of breaking the chat.
- Changing a setting no longer redraws the whole app, so the app stays smoother.
- Lighter companion and logo images make the chat home load faster and use less memory.

**Dev notes:** Performance and stability pass from the 2026-10-18 audit. api.ts bounds every Clerk getToken wait at 15 s (TOKEN_TIMEOUT_MS, fails like a timeout) in both makeAuthedFetch and apiJson. RouteErrorBoundary (src/components) is exported as ErrorBoundary from the root, (app), chat, bible, notes and settings layouts, and reports app_render_error with the error name only. MarkdownBody wraps the renderer in a plain-text fallback that retries on the next streamed chunk. settingsStore gains useSettingsSelector; useTheme, useResolvedTheme and useHighlightLabels subscribe to their slice only, and setSnapshot skips no-op writes. readingLogCore drops a corrupt stored row instead of throwing on every load. Companion poses resized 1145x1374 to 700x840 (5:6 framing kept, test updated) and the header mark to 256x256. Server-only work from the same audit (pdx1 region, billing and prompt-cache fixes) shipped separately and needs no app update.

## 1.94.0 (versionCode 108) - 2026-10-18 - internal and closed testing

**What's new (Play):**

NEW
- Coming up at church: the events announced at your church's services, like a ladies' fellowship or a trustees' meeting, now appear in Sermon studies with the announcement in the church's own words.
- Add any of them to Google Calendar or another calendar in one tap.
- If the time was not clear in the recording, SureWord says so and links the church's app for the exact time.
- Add a personal reflection when sharing a verse or today's word, and choose its font, card style and placement.

**Dev notes:** First Play build since 1.92.0 (106); 1.93.0 (107) was built but never published, so its reflection notes ride here. Church events: ChurchEventsCard (mobile/src/features/sermons) on the sermon list header and after the study's prayer, from the events and churchApp fields GET /api/sermon-studies and /api/sermon-studies/[id] now return. Google Calendar opens the server-built TEMPLATE URL; Other calendar downloads /api/church-events/[id]/ics with the Bearer token and shares it as text/calendar. Uncertain rows show a notice and the church's Google Play link. Server: ChurchEvent table (migration 20261018200000_church_events, applied to production), ingest route /api/sermon-studies/ingest/events, getChurchEvents chat tool. iOS mirrors it with EventKitUI (1.20.0 build 24).

## 1.93.0 (versionCode 107) - 2026-10-18 - internal and closed testing

**What's new (Play):**

NEW
- Add a personal reflection when sharing a verse or today's word. Write your own, or ask SureWord to connect the verse to your walk with God while keeping private details out.
- Edit every word and choose its font, card style and placement before previewing and sharing.

**Dev notes:** ReflectionSheet uses owner-only SharedCard drafts. AI generation reads private context into bounded spiritual themes, writes without raw records, then independently reviews privacy, grounding and Scripture fidelity. Consent and source changes invalidate generation. Manual entry needs no AI. Publication must match the saved preview. Presentation is stored by migration 20261018190000_share_reflection_presentation. Android, web and Apple share one renderer.

## 1.92.0 (versionCode 106) - 2026-10-17 - internal and closed testing

**What's new (Play):**

NEW
- Send a word to someone. Tell SureWord who it is for and what they are facing, and it finds a KJV verse and writes a few words just for them, ready to share as a card with your own message and name.
- Find it on the Bible tab, or tap Send to someone when you share a verse or today's word.
- See and take back the cards you sent in Settings, Shared answers.

**Dev notes:** SendWordSheet (mobile/src/features/shareCards) drafts through POST /api/cards/word, saves the sender's line with PATCH /api/cards/personal/{id}, previews the owner-only draft image, and publishes on the first share (frozen after). SentCardsSection lists and revokes. What the sender types about the situation is never stored. Consent policy "tap" for /api/cards/word.

## 1.91.0 (versionCode 105) - 2026-10-17 - internal and closed testing

**What's new (Play):**

NEW
- Share beautiful cards. Share a verse, your Pick Up Your Cross day or an answer as an image in three styles, Dawn, Parchment and Sanctuary, sized for stories or posts.
- Verse cards can carry a word of encouragement written for whoever reads it.
- Every card links to a page where friends can read the verse and ask SureWord about it.
- Pick Up Your Cross now has a Share button.

**Dev notes:** One server renderer draws every card (src/lib/share-cards, routes /api/cards/verse, /api/cards/cross/{id}, /api/shared/{id}/image). Sheet in mobile/src/features/shareCards; the JPEG is shared with expo-sharing (new native dependency, prebuild required). Encouragement comes from POST /api/cards/encouragement (cached per passage, AI consent "tap"). Text shares end with the sureword.app/v/<slug> door.

## 1.90.0 (versionCode 104) - 2026-10-16 - internal and closed testing

**What's new (Play):**

IMPROVED
- Scripture under an answer is now a short row of passages instead of a long list of verses. Tap a passage, or a verse reference in the answer, to read it in a sheet with Copy, Share, Save to note and Read in context.
- Passages show in the order the answer cites them, and search results keep their own section.

**Dev notes:** getPassage verses are tagged source "passage" in the chat view model and grouped by mobile/src/lib/versePassages.ts (byte-identical to src/lib/chat/versePassages.ts, tests/verse-passages.test.mjs). getPassage and the word-match tools (findVerses, searchOriginalLanguage, tagged source "exact") no longer show a fake 100% score, and only searchScripture scores feed the match badge. The sheet clears cached scroll offsets on close so every reopen scrolls to the chosen passage.

## 1.89.1 (versionCode 103) - 2026-10-13 - internal and closed testing

**What's new (Play):**

IMPROVED
- Bible search responds more reliably and reuses repeated searches.
- Note search keeps the newest edits and finds the best matches.
- Verse explanations follow your current AI model.
- Chat follows new answers with less motion.

**Dev notes:** Bounded embedding and SQL deadlines, source-checked note indexes, resolved-model insight cache, NKJV request deduplication, and Expo 57 compatibility patches.

## Rules (mandatory - applies to every agent and dev shipping Android builds)

1. **Every versionCode released to Google Play gets an entry here, written BEFORE the build is published.** No entry, no publish - `push-phone.sh` enforces this on every track (internal included) and on `--skip-build` uploads.
2. Entry heading format: `## <versionName> (versionCode <n>) - <YYYY-MM-DD> - <track>`. Newest entry at the top. `push-phone.sh` bumps the versionCode by one per run, so the entry names the code **about to be** published (app.json's current code + 1; with `--skip-build`, the current code).
3. Each entry carries a `**What's new (Play):**` block - that exact text ships to the Play Store. Keep it **under 500 characters** (Play rejects longer) and **write it for users, not engineers**: feature names as the app shows them (Chat, Bible, Notes, Pick Up Your Cross, Memories), no file names, no commit jargon. Engineering detail goes in the optional `**Dev notes:**` line below the block instead.
4. If a build is internal-only plumbing with nothing user-visible, the What's new block may say "Bug fixes and performance improvements." - but the entry itself is still required.
5. Server-side changes reach every installed build without a release - describe them that way rather than implying the APK carries them.

Entries below 1.19.0 predate this format and stay as they were.

---

## 1.89.0 (versionCode 102) - 2026-10-13 - internal and closed testing

**What's new (Play):**

IMPROVED
- SureWord asks about AI once, the first time you open the app, and never again. If you say no, it checks once, since most of SureWord runs on AI, and then remembers your choice on every device.
- Turn AI off or back on anytime in Settings, AI.

FIXED
- Pick Up Your Cross no longer shows a "needs your permission" card with a Try again button that did nothing.

**Dev notes:** Consent is asked once per account, ever. New `User.aiConsentDeclinedAt` (migration 20261013180000) records a confirmed no; `aiConsentDeclined` rides the preferences document; any recorded agreement counts regardless of copy version (no more re-asks on a version bump). The gate raises the sheet on launch for undecided accounts, joins waiting actions to the open sheet instead of refusing them, and "No thanks" moves to a "Turn off AI?" confirmation. Same state machine on web, Android and Apple.

## 1.88.1 (versionCode 101) - 2026-10-13 - internal and closed testing

**What's new (Play):**

FIXED
- The questions on the Chat home are chosen from your own study again: your reading, questions, notes, memories, and today's verse. They had fallen back to the same six starter questions for everyone.

**Dev notes:** useSuggestedQuestions ran before AIConsentPresenter configured the consent gate (sibling effect order), so the automatic request was refused on the device and the static six were cached for the session. The hook now waits for the gate to hold current consent. Server generation was never broken. Web fixed in 2289c16.

## 1.88.0 (versionCode 100) - 2026-10-12 - internal and closed testing

**What's new (Play):**

NEW
- A calmer Chat home with warm gold, ivory, and charcoal colors, a friendly study companion, and easy-to-read question cards.
- Your companion reaches upward while preparing an answer and raises its arms in praise as the answer arrives.
- All your study questions are still there. Tap the extra-questions button to see more.

IMPROVED
- Clearer Chat options, larger touch targets, and comfortable spacing for the keyboard and large text.

**Dev notes:** Approved chat redesign with shared three-pose artwork. Native motion respects reduced motion, screen readers, and app visibility. Scoped colors preserve Bible reader ink. Notes clearance derives the actual tab height and bottom inset.

## 1.87.1 (versionCode 99) - 2026-10-11 - internal and closed testing

**What's new (Play):**

FIXED
- The dawn welcome now plays only when you open SureWord fresh. Switching back to the app from another app or the home screen takes you straight to where you were.

**Dev notes:** Austin, 2026-10-11: the splash replayed on every return from the background (1.86.0 added background-return replay on purpose). It now plays once per JavaScript process, which on Android is exactly a cold start; backgrounding mid-reveal still ends it. The same change ships on web (a tab switch no longer replays it; a page load is the cold start) through the sureword.app deploy, and in the Apple source (1.14.1 (17)), which ships with the next Mac release.

## 1.87.0 (versionCode 98) - 2026-10-09 - internal and closed testing

**What's new (Play):**

IMPROVED
- Security update: files you share into SureWord from other apps are checked against the size limit before they are copied, and nothing is left behind in storage when a file is too large.
- Your notification settings now stay tied to this phone, so another account cannot take over its reminders.

**Dev notes:** Security scan 2026-10-09 fixes. #8: expo-share-intent no longer copies every shared file into cacheDir on arrival (patch), and shared files are copied by the new SureWordShare native module with a hard cap (the type's limit, or what the 25 MB message budget has left), using the measured size. #10: push registration sends and stores the server's device proof (HMAC of the Expo token), so a bound token moves accounts only with it. Server-side fixes (voice-message quota ledger, church SSRF guard and save limit, note folder ownership, answer forgery, share-card caching) reach every installed build through the sureword.app deploy, not this APK.

## 1.86.0 (versionCode 97) - 2026-10-09 - internal

**What's new (Play):**

NEW
- A beautiful dawn welcome for your walk with God, with a short, silent reveal when you open SureWord or return to it.
- Tap to skip. Reduced-motion and screen-reader settings take you straight into the app.

**Dev notes:** Original local dawn artwork, native image animation, real background-return replay, inactive-dialog guard and bounded cleanup.

## 1.85.0 (versionCode 96) - 2026-10-09 - internal

**What's new (Play):**

NEW
- Your walk: the Reading log opens with a short reflection on your reading, tied to your questions, notes and prayers, with a KJV verse to carry and what to read next.
- Your Bible: every book with the chapters you have read; open any chapter from there.
- Listen now reads the whole Bible, Genesis to Malachi, with read-along and Listen from any verse.

IMPROVED
- Reading log stats in plain words, history grouped by day, and pull to refresh.

**Dev notes:** Two features in one build. Reading log: server half shipped in 9fabd03 (GET /api/reading-log/overview and /api/reading-log/reflection, ReadingReflection table); the reflection is an automatic AI-consent route, free for every account, and without consent the card offers "Write my reflection". Old Testament audio: `NARRATED_BOOKS` in `features/bible/audioBible.ts` is now 1-66 (was 40-66), so the reader asks `/api/bible/audio` for Old Testament chapters; the server already answers per chapter. Audio rendered by Context-Pro-AI LC-15317 (narrator only, no chapter cues).

## 1.84.1 (versionCode 95) - 2026-10-08 - internal

**What's new (Play):**

FIXED
- Returning to the reader after narration advances keeps the correct verse in view, including when the next chapter is shorter.
- Stale reader scrolls no longer interrupt playback or close the app.

**Dev notes:** Preserve the 1.84.0 Copy/Edit/Try again and reasoning controls. Validate the live chapter, inner list bounds and queued callbacks during a chapter replacement.

## 1.84.0 (versionCode 94) - 2026-10-08 - internal

**What's new (Play):**

NEW
- Copy, edit and resend your own questions. Long-press any question, or use the buttons under your newest one. An edit keeps its attachments and replaces the replies after it.
- Try again on the newest answer to get a fresh one.
- SureWord Pro can choose how hard SureWord thinks: Low, Medium or High.

IMPROVED
- Answers are fast again. Free accounts now see "SureWord AI" instead of a model name.

**Dev notes:** Edit = AI SDK `sendMessage({ messageId })` via `editedUserMessage` (`features/chat/editMessage.ts`), Try again = `regenerate()`; `/api/ask-question` deletes the stored rows after a re-sent user message id. The included-model speed fix (back to Luna medium) and the "SureWord AI" label are server-side and reached every installed build at deploy. Pro reasoning chips render from `house.efforts` on `GET /api/ai/models`.

## 1.83.0 (versionCode 93) - 2026-10-08 - internal

**What's new (Play):**

NEW
- Listen to the narrated KJV New Testament in the Bible reader, follow each verse, skip verses, change speed and keep listening with the screen off.
- Review how SureWord uses AI before your first AI request, and withdraw permission in Settings > AI.

**Dev notes:** Native chapter narration and versioned AI consent now match the Apple clients. Reading, history and existing audio stay available without AI consent. Consent waits cancel on Stop and cannot cross accounts.

## 1.82.0 (versionCode 92) - 2026-10-08 - internal

**What's new (Play):**

IMPROVED
- The King James Bible in SureWord is now the standard 1769 text, checked word for word. Missing and misprinted words are restored (Mark 15:2 "said unto him", 1 Samuel 15:33 "As thy sword", and more), along with the KJV's own spellings and punctuation.
- Psalm titles are no longer counted as verse 1.
- Bible search finds names written either way, like Bethel or Beth-el.

**Dev notes:** `scripts/bible/build-kjv.py` builds the KJV from eBible.org `eng-kjv` USFM, validated letter for letter against eBible's VPL export, replacing the Project Gutenberg #10 text and `mobile/scripts/build-kjv-data.py`. 1,223 verses changed (131 with word or spelling differences, the rest punctuation and hyphenated names). Red-letter sidecar regenerated with no edition aliases. Search folds intra-word hyphens on every client and in `KjvVerse` (migration `20261008120000_kjv_search_joins_hyphens`). Production `KjvVerse` and `VerseEmbedding` resynced.

## 1.81.1 (versionCode 91) - 2026-10-08 - internal

**What's new (Play):**

FIXED
- Corrected misspellings in the Bible text, including Galatians 2:20 ("nevertheless"), Jonah 1:15 ("took up Jonah") and Genesis 47:4 ("moreover"). Malachi 4:6 no longer ends with a stray "The New Testament" heading.

**Dev notes:** The bundled KJV came from Project Gutenberg #10, which carries these typos. Fixed in `biblical-texts/KJV-Bible.txt` and regenerated with `mobile/scripts/build-kjv-data.py`; 11 verses: Gen 14:5, 47:4, Josh 18:23, 2 Sam 14:10, Prov 6:26, Ezek 22:21, Jonah 1:15, Mal 4:6, John 21:18, Gal 2:20, 1 Tim 6:14. Found by a word-level diff against eBible's Cambridge KJV (eng-kjv2006). Pinned by `tests/kjv-text.test.mjs`.

## 1.81.0 (versionCode 90) - 2026-10-07 - internal

**What's new (Play):**

NEW
- /verify checks a YouTube video or a web link against Scripture. Paste a link after /verify, or share a video from the YouTube app and tap "Verify this video". SureWord reads what was said, lists the claims with timestamps and weighs each one against the KJV, showing each step while it works.

**Dev notes:** The phone fetches the captions itself (`features/chat/videoTranscript.ts`, innertube ANDROID then IOS client, json3 into 30-second stamped paragraphs, capped at 300 KB) because YouTube refuses Vercel and the VPS ("Sign in to confirm you're not a bot", measured 2026-10-07); the transcript rides the normal text-attachment upload as `YouTube-transcript-<title>.txt`. Composer shows "Finding the video...", "Reading the captions of ...", "Sending SureWord the transcript ...", then the server's progress ("Reading the video's transcript"). A send that outlives its draft (New chat or History mid-fetch) is dropped and its upload deleted. Web links go through the new server `readLink` tool (Tavily Extract), allowlisted to links the user typed. Share sheet leads with "Verify this video" / "Verify this link" when the share carries a link. TikTok captions are not reachable from the public page, so a TikTok link checks only the post's caption.

## 1.80.0 (versionCode 89) - 2026-10-07 - internal

**What's new (Play):**

NEW
- Delete account: in Settings, Account, you can now permanently delete your SureWord account and everything in it. SureWord lists what goes and asks you to type DELETE before anything is removed.

IMPROVED
- Pick Up Your Cross: the Listen card now says plainly that Listen is included with SureWord Pro.

**Dev notes:** Account deletion calls the existing `DELETE /api/account` (body `{"confirm":"DELETE"}`) through `apiJson`; status handling lives in `features/settings/accountDeletion.ts` (`reduceDeletion`, mirrored from the Apple `AccountDeletionModel`, tests in `accountDeletion.test.ts`): 500 means nothing was removed, 502 or a lost response offers Try again, and a 401 after one of those counts as done. On success it runs `clearUserCaches()` then signs out of Clerk. The route was already live server-side for every build.

## 1.79.0 (versionCode 88) - 2026-10-07 - internal

**What's new (Play):**

NEW
- /check weighs a claim, a screenshot or a voice message against Scripture.
- /reply helps you answer someone gently from Scripture.
- Voice messages: attach or share an audio clip and SureWord reads what was said.
- Share into SureWord from Discord, Messages and other apps.
- My testimony: tell SureWord privately how you came to faith (Settings, Memory).

**Dev notes:** Server answers "the KJV mistranslates", borrowed beliefs (karma, self-salvation) and skeptics from the guidance shipped in 9457b35, live for every build. Audio is transcribed once at upload (free 10 min/day, Pro uncapped) and the model reads the transcript. Native share target via expo-share-intent 8.0.1 (prebuild --clean), patched so an unreadable share no longer blanks the app and files are read through the granted content:// URI, then copied to the cache before upload. New columns User.testimony and ChatAttachment.transcript/durationSeconds were applied to production before release.

## 1.78.0 (versionCode 87) - 2026-10-01 - internal and closed testing

**What's new (Play):**

NEW
- Pick Up Your Cross audio is now made when you ask. Choose a narrator, preview their voice, and pick Calm, Natural or Expressive delivery before generating.
- Your audio is saved for repeat listening. Adjust playback speed and read along with the transcript.

**Dev notes:** Removes automatic narration from the daily cron, day reads and replacements, and chat tools. One atomic generation claim per day, private audio and Pro access remain in place. The same bundle is promoted to closed testing.

## 1.77.0 (versionCode 86) - 2026-09-23 - internal

**What's new (Play):**
Shared answers can now be shown in search. In Settings, Shared answers, turn on Show in search for any answer you have shared and people can find it on Google. Links stay unlisted unless you choose this, SureWord asks before turning it on, and your name is never shown. Revoking a link also takes it out of search.

**Dev notes:** The APK half is the "Show in search" switch in `features/chat/SharedAnswersSection.tsx` plus `setShareListed` / `listed` parsing in `shareApi.ts` (tests in `shareApi.test.ts`). Server-side and already live for every build on deploy: `PATCH /api/shared/{id} { listed }`, `SharedAnswer.listedAt` (migration `20260923180000_guest_turns_and_listed_shares`, applied to production 2026-09-23), listed answers indexable and in the sitemap, and the web landing page's try-before-you-sign-up guest answers (`/api/guest/ask`, `/api/guest/claim`), which are web-only for now.

## 1.76.0 (versionCode 85) - 2026-09-22 - internal

**What's new (Play):**
Chat scrolls more smoothly through long conversations, and Bible verse links can open the reader from outside the app. Memories has more time to finish a summary. If deleting a chat fails, SureWord now tells you and restores it in your history.

**Dev notes:** Android chat uses a virtualized message list, memory summary requests allow five minutes, failed deletes refresh history and alert, and `sureword://verse?ref=...` routes through the validated reader reference parser. The shared API and web fixes in this release are deployed separately to Vercel.

## 1.75.0 (versionCode 84) - 2026-09-20 - internal

**What's new (Play):**
You can talk Sunday's message over with SureWord. Open a sermon study and tap Ask AI at the bottom, or just ask in Chat: "what did we study Sunday?", "explain the second point", "help me live this out this week". It reads the whole study, keeps the preacher's own words separate from its own teaching, and can point you at the moment in the recording. Watch the service now sits in the same bar.

**Dev notes:** The APK half of this is small: `bible/sermon.tsx` gains a dock in the shape of the Bible reader's, Watch the service on the left and Ask AI on the right, where Ask AI prefills an ordinary sentence naming the study and sends nothing hidden with it. The rest is server-side and already reached every installed build on deploy of `224e64a`: two read-only chat tools (`listSermonStudies`, `getSermonStudy`) scoped by the same `UserChurch.youtubeChannelId` rule as the screens, a line in the chat day block naming this week's study so the assistant knows a sermon happened before being asked, and `sermonGuidance` in the system prompt. The lookup answers a date with no service with the service before it, labelled, and tells a reader with no church apart from a church whose studies did not match - a model that conflates those tells a user with studies that they have none. Quotes reach the model labelled verbatim from the recording and explanations labelled as SureWord's, because a congregation member will read anything attributed to their pastor as a report of what he preached; `tests/sermon-studies.test.mjs` reads the output back and checks both labels survive.
## 1.74.0 (versionCode 83) - 2026-09-20 - internal

**What's new (Play):**
Sermon studies. When your church streams a service, SureWord now turns it into a guided walk through the message: the preacher's own words with a link straight to that moment in the video, the passages in King James, an explanation of each point, a question to carry with you, and artwork along the way. Look for Sermon studies in the Bible tab. Also fixes a fresh install briefly signing itself out before the sign-in screen appeared.

**Dev notes:** New `/bible/sermons` list and `/bible/sermon` detail screens reading `GET /api/sermon-studies` and `/api/sermon-studies/[id]`; the Bible tab row only appears when the account's church has a channel wired up (`UserChurch.youtubeChannelId`), so it stays invisible for everyone else. Studies are built off-device by `scripts/sermon/ingest.mjs` (yt-dlp + local faster-whisper + two model passes) and posted to `POST /api/sermon-studies/ingest`; ingestion cannot run on Vercel because YouTube blocks datacenter IPs and transcription needs a GPU. Quotes are anchored to a transcript timestamp and lifted verbatim rather than written by the model, and scripture is re-rendered from the bundled KJV. This build is also the first to carry `66af619` from a concurrent session: the `(app)` shell only redirects once Clerk has loaded, so `useSureWordChat` mounted during that window, asked `/api/conversations` for nobody's conversations, took a 401 and ran `reportAuthFailure`, signing out an account that was never signed in.

## 1.73.2 (versionCode 82) - 2026-09-20 - internal

**What's new (Play):**

- Bug fixes and performance improvements.

**Dev notes:** Chases down the three `request_failed` events Google's Play reviewer produced on 1.73.1, all of which were false alarms against turns the server had answered and persisted. Two causes, both ours. First, a caller-initiated abort was being filed as a network failure: `isNetworkFailure()` returns true for `AbortError`, so pressing stop, leaving the chat screen, or the chat hook cancelling a send all counted as `kind: "offline"`. `makeAuthedFetch` now checks the caller's signal first and reports nothing when the caller asked to stop; pinned by two tests in `api.test.ts`, one of which was confirmed to fail against the old code before being kept. Second, Android suspends a backgrounded app's sockets, so a long answer dies mid-flight whenever someone locks their phone while SureWord is thinking. That is not a broken product (the server drains its own stream copy and persists the answer, and `answerRecovery` collects it on return), so `request_failed` now carries `app_state`, which keeps those distinguishable instead of dropping them: how often people lose a stream by leaving is a real question. Also replaces the `register()` added in 81 with a synchronous `before_send` hook. `register` lost a race: the SDK runs `capture('Application Installed')` during startup before an async register has persisted anything, while `Application Opened` happens after an internal `await` and did pick the properties up, so the install event (the one a test-account filter most needs) was the single event still carrying no `is_test_client`. `before_send` runs on the way out and cannot lose that race.

## 1.73.1 (versionCode 81) - 2026-09-20 - internal

**What's new (Play):**

- Bug fixes and performance improvements.

**Dev notes:** Two fixes found by proving 1.73.0 (80) on the emulator against the signed release APK, both in the measurement added by that build. First, the four SDK-native lifecycle events (`Application Installed`, `Application Opened`, `Application Backgrounded`, `Application Became Active`) are built inside `posthog-react-native` and never pass through `track()`, so they carried no `is_test_client`, `environment`, `platform` or `source`. That is backwards: those are the events that produced the phantom "new users" on 2026-09-20 and they were the only ones the project's test-account filter could not see. `mobile/src/lib/analytics.ts` now calls `analytics.register(BASE_PROPERTIES)`, whose super properties merge into every event the client sends, the SDK's own included. Second, the new `request_failed` event immediately caught the app calling `GET /api/conversations` from the sign-in screen on a fresh install and taking a 401; the server is correct there, and counting it would have made 401 the loudest and least useful row in the metric, so `apiJson` now tracks whether the attempt carried a session token and skips the report for a signed-out 401 while still reporting a real auth breakage. The underlying call from the signed-out screen is a separate defect and is NOT fixed here. Proof that 80 worked, from production PostHog: one launch produced one distinct_id and one person across `Application Opened`, two `screen_viewed` rows (`/` and `/sign-in`, route patterns) and `Application Installed`, where the same sequence a day earlier produced two people.

## 1.73.0 (versionCode 80) - 2026-09-20 - internal

**What's new (Play):**

- Bug fixes and performance improvements.

**Dev notes:** The first two days of measurement were wrong and this release is why. PostHog reported four new users on the morning of 2026-09-20; there were none. Both clients called `reset()` whenever Clerk reported nobody signed in, which it does for a beat on every cold start, and `reset()` mints a fresh anonymous id: every launch's `Application Installed` and `Application Opened` were stranded on a person the account never merged with, and the wiped persistence made the next launch call itself an install too. Measured on Austin's own phone, the distinct id changed 3.4 seconds after launch with no `$identify` between. Six launches by two people (this machine's emulator, Austin's phone, and four Google Play review devices running the reviewer demo account) were reported as six new users, while Neon showed zero new accounts on both days. A reset now requires a previous user, on Android and on web, pinned by `tests/analytics-event-mirror.test.mjs`. `personProfiles: "identified_only"` matches web so an anonymous launch no longer stores a profile at all. Internal traffic is excluded at the source: `INTERNAL_USER_IDS` (Austin + the Play reviewer) sets PostHog's `$internal_or_test_user` person property server-side, emulators and dev builds self-flag with `is_test_client`, and both feed the project's `test_account_filters`, now default-checked. Screen views existed only on paper before this build: `captureScreens` hooks a React Navigation container and expo-router owns its own below `PostHogProvider`, so 32 screens sent 0 events. `mobile/src/features/analytics/useScreenTracking.ts` sends them from `useSegments()`, which yields route patterns (`/bible/atlas/[id]`), so no id or book name can reach a payload. New drop-off events: `sign_in_started` / `sign_in_completed` / `sign_in_failed` across all three methods (Clerk's error code only, never the identifier), `request_failed` from the two choke points in `mobile/src/lib/api.ts` (throttled to one per route and cause per 30s, path reduced by `routeShape`), and server-side `provider_failed` from `recordTurnError`. `api.ts` reaches analytics through `setRequestFailureReporter` rather than an import, because importing the analytics module into a unit-tested file dragged `expo-device`, `posthog-react-native` and `__DEV__` into five unrelated suites.

## 1.72.1 (versionCode 79) - 2026-09-20 - internal

**What's new (Play):**

- Fixes a crash that stopped SureWord from opening at all. 1.72.0 closed instantly on launch, before the splash screen even appeared. Everything is back, and nothing you saved was lost: Chat, Bible, Notes, Pick Up Your Cross and your memories are all where you left them.

**Dev notes:** 1.72.0 added `expo-application` and `expo-localization` for `posthog-react-native` and pinned both off the SDK 57 line (`~7.0.0` resolved to 7.0.8, `~17.0.0` to 17.0.9). Those are the packages' legacy standalone version lines, built against an older `expo-modules-core`, so `LocalizationModule.definition()` called a `ReturnType(KClass)` constructor that 57.0.10 no longer has. `java.lang.NoSuchMethodError` was thrown from `ModuleRegistry.register` while `AppContext` assembled the Expo module registry, which happens before any JS runs and therefore before the splash screen: every launch died, on every device, with no recovery from clearing data. Repinned to `expo-application@~57.0.3` / `expo-localization@~57.0.2`, the versions `expo install` resolves, plus the `expo-localization` config plugin the SDK 57 package ships (it only adds `locale|layoutDirection` to the main activity's `configChanges`). `expo-device` and `expo-file-system` landed in the same commit already on the 57 line, which is why localization was the one that fired. Reproduced and verified on the emulator against the signed release APK, not a debug build.

## 1.72.0 (versionCode 78) - 2026-09-19 - internal

**What's new (Play):**

- Send feedback: Settings now has a place to tell us what is broken, what is missing, or what you want SureWord to do. Add your email only if you want a reply. A person reads every one.
- SureWord now measures how the app is used, so we can fix what gets in the way: screens opened, whether an answer finished, how you rated it. Never the content of your study, and never your screen.

**Dev notes:** PostHog lands in this build via `posthog-react-native`, mounted in `mobile/app/_layout.tsx` (screen views and app lifecycle; `captureTouches: false`, because touch autocapture records the text of whatever was tapped, which here is a verse or a saved question). `mobile/src/lib/analytics.ts` holds the client; the identify/reset bridge sits beside `AuthFailureBridge` so signing out cannot leave one account's trail for the next person on the phone. `x-sureword-client: android` now rides every request from `mobile/src/lib/api.ts`, so the server files metrics, ratings and feedback under the real platform instead of sniffing a user agent that says "okhttp". The feedback screen is `mobile/app/(app)/settings/feedback.tsx` over `POST /api/feedback`, with the rules mirrored in `mobile/src/lib/inAppFeedback.ts` and pinned by `tests/in-app-feedback-mirror.test.mjs`. Server-side analytics shipped earlier the same day and already covers every installed build, so this release adds the screen-level half only.

## 1.71.0 (versionCode 77) - 2026-09-18 - internal

**What's new (Play):**

- The AI model picker in Chat is redesigned: it now fills the screen with two tabs, Models and Options. Models gets the whole height for search and the list, and Options lays every Reasoning, Speed, Length and Mode choice out in a tidy grid, so nothing is cut off or hidden behind a sideways scroll.
- "Add an API key" now sits at the end of the model list as a tappable row.

**Dev notes:** `mobile/src/features/chat/ModelPickerSheet.tsx` moves to a fixed-height sheet (`heightRatio` 0.86 in keys mode; house mode, loading and error still size to content) split by `StudyTabs` (new optional `style` prop) into a MODELS pane (pinned search, scrolling grouped list, single provider renders as a static section header rather than an accordion) and an OPTIONS pane (one card per section, chips in a percent-width wrapping grid sized by `optionGridColumns` in `modelPickerRules.ts`, unit tested). Removes the chrome/options `onLayout` height juggling and the horizontal chip ScrollView. Web keeps its own layout (popover with the same sections); no capability changed on any client.

## 1.70.3 (versionCode 76) - 2026-09-18 - internal

**What's new (Play):**

- The SureWord icon in the status bar and notification shade is now full size, like every other app's, instead of a small mark floating in the middle of its tile.

**Dev notes:** `mobile/assets/notification-icon.png` was a hand-made 96px file whose glyph covered only 52x49px (about half the tile); Android draws the small icon at 24dp with no padding of its own, so it rendered at roughly half the size of neighbouring apps. The icon is now emitted by `scripts/apply-logo.py` from the same master as every other icon (white alpha glyph at 92% fill, proof sheet in `.logo-work/preview-notification.png`), and `push-phone.sh` hashes the icon PNGs into its prebuild stamp so a regenerated icon forces the `expo prebuild` that bakes it into `res/`. Android-only asset; web and Apple have no equivalent small-icon surface.

## 1.70.2 (versionCode 75) - 2026-09-17 - internal

**What's new (Play):**

- In the Words tab, the "Ask about this word" button now sits on one line beside "Every verse".
- Studies mention how often a word recurs only when it is a true refrain of the book, instead of listing numbers for every word.

**Dev notes:** Android carries only the button-row weights from 7c0c12e (`mobile/src/features/bible/WordStudySection.tsx`, primary 3 : secondary 2). The study wording change is server-side (`VERSE_WORDS_PROMPT_VERSION` 2 in `src/lib/verse-words.ts`, deployed 7c0c12e) and reaches every installed build; it is listed here because 1.70.1 (74) shipped the Words tab before that prompt landed.

## 1.70.1 (versionCode 74) - 2026-09-17 - internal

**What's new (Play):**

- The Bible tab's header is tidy again. The lone clock icon that sat under the "Bible" title is now a labeled Reading log button beside the title, so it is clear what it opens.

**Dev notes:** The reading-log `Pressable` in `mobile/app/(app)/bible/index.tsx` was a bare icon stacked in the column header; it now shares a `titleRow` with the heading as an `accentSoft` pill with a label. Android-only layout fix; web and Apple Bible headers were never affected (`docs/PARITY.md`).

## 1.70.0 (versionCode 73) - 2026-09-17 - internal

**What's new (Play):**

- The Words tab on a tapped verse is a real word study now. Every Hebrew or Greek word sits next to the King James wording it became, with a plain spelling and one line on what the original carries, followed by a short study of what the original says and one line to carry with you.
- Tap any word for more: its grammar in plain words, the Strong's definition, other verses that use the same word, and buttons to ask about it in Chat or see every verse where it appears.

**Dev notes:** `POST /api/verse-words` builds the study from the bundled WLC/TR words, Strong's and the KJV, cached per verse for everyone in `VerseWordStudy` (`src/lib/verse-words.ts`, contract in `src/lib/verse-words-contract.ts`). Morphology codes decoded by `src/lib/bible/morphology.ts`; `GET /api/bible/strongs?examples=` adds occurrences. Android renders it in `mobile/src/features/bible/WordStudySection.tsx` + `useVerseWords.ts`, replacing `OriginalLanguageSection`. Web and Apple rebuilt in the same cycle (`docs/PARITY.md`).

## 1.69.0 (versionCode 72) - 2026-09-17 - internal

**What's new (Play):**

- Settings is a short list now instead of one long scroll. Your account and Check for updates sit at the top, and every area (Appearance & reading, Highlight labels, My church, Memory, AI, Shared answers, Notifications, About) opens on its own page with a Back button.
- Each row shows where things stand at a glance: your theme and translation, your church, whether memory is on and how many memories are saved, how many AI keys you have added, and when the daily verse arrives.

**Dev notes:** `mobile/app/(app)/settings.tsx` became the nested stack `mobile/app/(app)/settings/` (`_layout.tsx` anchored on `index`, one file per page). Shared top bar, switch row, hub row and group card live in `mobile/src/features/settings/SettingsChrome.tsx`; `HighlightLabelsSection`, `ChurchSection` and `SharedAnswersSection` gained a `hideHeading` prop for their pages. The model picker's "add a key" pushes `/settings/ai`; memory and church receipts push `/settings/memory` / `/settings/church` (`receiptRoutes.ts` + tests). Web and Apple layouts unchanged (capability parity, `docs/PARITY.md`).

## 1.68.0 (versionCode 71) - 2026-09-17 - internal

**What's new (Play):**

- Copy any answer with one tap. The row under each answer is now a tidy set of icons: Copy, Add to notes, Helpful, Not helpful, Share.
- When an answer misses the mark, tell us why in a tap: pick from Not KJV, Doctrinally off, Missed my question, Wrong or missing verse, or Too long, and add a note if you like.

**Dev notes:** `copyableAnswerText` in `mobile/src/lib/assistantMarkdown.ts` strips the follow-up marker lines before the clipboard write. The reason chips are `FEEDBACK_TAGS` (mirrored from `src/lib/chat/answer-feedback.ts`, pinned by `tests/answer-feedback.test.mjs`) and travel as `feedbackTags` on the existing feedback PATCH; the `Message.feedbackTags` column landed in production on 2026-09-17 (`20260917000000_answer_feedback_tags`). `scripts/sql/product-metrics.sql` §8b counts thumbs-down per chip.

## 1.67.0 (versionCode 70) - 2026-09-16 - internal

**What's new (Play):**

- Chat opens as a chat now: the SureWord mark, your opening questions, and the message box right where your thumb is. The long welcome text is gone, and the box stays put when your first answer arrives.
- Your opening questions show four at a time, with a tap to see the rest.

**Dev notes:** `WelcomeState` rewritten around a docked composer: `index.tsx` renders the input bar in every state (the welcome no longer takes a `composer` prop), the hero is the 96px guide mark plus the headline centred in the free space, and the questions are compact rows with a `+N more from your study` reveal (`VISIBLE_QUESTION_COUNT = 4`, server order untouched). The stained-glass welcome asset is deleted. The same commit trims web, macOS and iOS to the headline (`tests/welcome-copy-parity.test.mjs` now asserts the pitch stays off every empty-chat surface); the Swift edits await the next Mac compile.

## 1.66.0 (versionCode 69) - 2026-09-16 - internal

**What's new (Play):**

- Highlight labels now ask why you reach for each color: give every color a name and a one-line meaning, or tap "Use suggested labels" for a ready-made set (Favorite, Promise, Command, Warning, Question and more). The assistant reads your meanings, so a marked verse carries your reasons into Chat.
- New in Settings under Memory: "About me". Tell SureWord in your own words where you are in your walk and what you want from the app, and every conversation starts from that.

**Dev notes:** `User.highlightMeanings` (JSON) and `User.aboutMe` (text), migration `20260916030000_highlight_meanings_about_me`, applied to production 2026-09-16. Both sync through `GET/PATCH /api/preferences`. Server side, the chat and note-assistant prompts gain a highlight legend (label, meaning, verse count per colour; `src/lib/highlight-legend.ts`) and an About me block, which every installed build benefits from without this release; the APK carries the two Settings sections and the contract mirror in `mobile/src/features/settings/preferences.ts`.

## 1.65.0 (versionCode 68) - 2026-09-16 - internal

**What's new (Play):**

- Notes got a cleaner look: a calmer editor bar with just the title, the AI assistant and a menu, and new icons throughout Notes.
- Copy as Markdown and Share as Markdown now live in the note menu, alongside Pin, Tags, Note info, Move to folder and Delete.

**Dev notes:** Notes moves to Lucide icons (`lucide-react-native` + `react-native-svg`, per-icon imports) to match the web's icon family; `GlyphButton`/`SheetRow` accept a Lucide `Icon` alongside the Ionicons name. The editor's "Copy Markdown" text link and its status line are gone; `NoteActionSheet` is the one note menu for the editor and the card long-press. New native module, so this build is a fresh prebuild.

## 1.64.0 (versionCode 67) - 2026-09-16 - internal

**What's new (Play):**

- A calmer verse sheet: tap a verse and a small card slides up with the explanation, your highlight colors and one row of actions - Ask, Copy, Share, Note, Learn - while the chapter stays readable behind it. Drag up to study: Explain, Words (the Hebrew or Greek) and See also, one at a time.
- Select a passage: keep tapping verses to grow the selection, then highlight, copy, share, save or learn all of them together.
- Re-tap your highlight color to remove it.

**Dev notes:** The verse sheet is no longer a Modal; `mobile/src/features/bible/verse-sheet/` holds the gesture-driven two-tier VerseSheet (Reanimated + gesture-handler), VerseActionBar, StudyTabs and InsightTeaser; selection rules live in `verseSelection.ts` (mirrored on web with a parity test). Server: `/api/verse-insight` explains a range reference as one passage under the existing cache (single-verse prompt text unchanged, no version bump). Web restructured to the same tabs + action bar with multi-select.

## 1.63.0 (versionCode 66) - 2026-09-15 - internal

**What's new (Play):**

- Tell SureWord how an answer landed: thumbs up or down under any answer, with a line about what went wrong if you like.
- Share an answer: one tap makes a link anyone can open, with a preview card; manage or revoke your links in Settings → Shared answers.

**Dev notes:** feedback columns + PATCH rules and the SharedAnswer snapshot/public page/card are server-side (8096378, da6577f, b6490e7); this APK carries the thumbs + FeedbackSheet, the Share glyph + shareApi, and the two Settings sections.

## 1.62.0 (versionCode 65) - 2026-09-15 - internal

**What's new (Play):**

- Prayer requests come back to you: the assistant gently asks how a request went, and Settings → Memory lets you mark one Answered, Close it or Reopen it in a tap.
- Everything the assistant saves shows as one line of tappable receipts under its answer - notes, memories, highlights, your plan, today's cross, Learn - with Undo on a remembered memory.
- Pick Up Your Cross: "Stay with this" takes today's theme further; "Take me somewhere fresh" moves to a different area of life.

**Dev notes:** prayer columns + resolvePrayerRequest tool and the follow-up block are server-side (6700adf, 018cfc0); this APK carries the Memories screen status rows, the ReceiptLine + typed receiptRoutes (bbb3e94) and the cross DirectionControls (356c771). The versionCode 64 APK carried the Learn receipt only.

## 1.61.0 (versionCode 64) - 2026-09-15 - internal

**What's new (Play):**

- Ask SureWord to teach you a verse: say "learn John 3:16" in chat and it joins your Learn queue, with a receipt that opens the Learn screen.
- Say "quiz me" and the assistant quizzes you on your verses at your level, never revealing the hidden words before you answer.
- Pro subscriptions stay active through renewals, and abandoned checkouts no longer appear in Membership.

**Dev notes:** learnVerse / getLearnVerses chat tools + learnGuidance are server-side and reach every installed build (c512857); this APK carries the "Learning <reference>" receipt, its Learn-route target, and the streaming activity labels. Billing fixes are server-side (12c61ff, 98ebd12e).

## 1.61.0 (versionCode 63) - 2026-09-13 - internal

**What's new (Play):**

- Free study remains available with 10 included AI actions each day.
- Pro membership can use Google Play billing when enabled for your account.
- Restore a Google Play subscription on another device after Google confirms it.
- Your Bible, notes, highlights and saved study remain available when AI limits are reached.

**Dev notes:** Adds the native Google Play subscription flow for `sureword_pro`, including localized pricing, account binding, server verification and acknowledgement only after verification. Merchant product configuration and production enablement remain pending; purchase UI is feature-flagged off until the backend reports Play checkout availability.

## 1.60.0 (versionCode 62) - 2026-09-13 - internal

**What's new (Play):**

- A calmer Bible reader with more breathing room, simpler reading controls, and easier chapter navigation.
- Jesus' words appear in red in KJV and BSB, with section headings to guide your reading.
- Read and search the full Berean Standard Bible offline, alongside KJV.
- Your highlights, notes, and reading history stay with you.

**Dev notes:** Adds publisher-sourced BSB text, speech spans, headings, and italics; all 31,102 verse slots are checked against the publisher's plain-text edition. KJV retains its existing text with validated eBible speech annotations and separately credited BSB editorial headings. Shared web/backend supports BSB preferences, lookup, search, attachments, and learning, plus public cached chapter/version endpoints. NKJV annotations and the SwiftUI reader migration remain separate work. Verified Android reader, settings, and chapter navigation in the emulator.

## 1.59.0 (versionCode 61) - 2026-09-12 - internal

**What's new (Play):**

- Follow SureWord's work in a new activity card, with helpful summaries as it researches and prepares your answer.
- Expand “Worked for” to revisit the steps, passages, and sources behind an answer.
- Smoother follow-ups and connection recovery, plus better hardware keyboard support.

**Dev notes:** Shared backend adds factual progress snapshots and optional fast narration. The Android client renders and restores the new activity history. Fixes orphaned OpenAI history references, distinguishes explicit provider failures from transport loss, recognizes Android connection aborts, and preserves composer clearance with a zero-height hardware-keyboard IME. Includes all changes in 1.58.0. Authenticated native passage, web research, saved-history and follow-up runs were verified; the user approved the final activity UI.

## 1.58.0 (versionCode 60) - 2026-09-12 - internal

**What's new (Play):**

- Learn a verse now suggests what to learn. SureWord reads your own walk, the verses you marked, the chapters you read, what you asked about, and offers the ones Scripture itself leans on most, saying why it chose each.
- Four ways to practise the same verse: fill the blanks, first letters, tap the words back into order, or write it out and have it checked word for word.
- Which one you get follows how well you know the verse, and you can switch at any time.

**Dev notes:** Server half shipped earlier (b71f9a8, aeb1f16): `GET /api/learn/suggestions` ranks a verse only when weight and nearness are both true. Weight is inbound cross-references from the bundled corpus, inverted once into `src/data/learn/verse-significance.json` (225,683 edges, 10,792 verses at 12+); nearness is highlights, reading, chat citations, past crosses and notes. At most two per source, and a reading signal needs weight 40+ because it names only a chapter. This build carries the Android client: the "Suggested for you" section (which becomes the screen when nothing is due, so the empty state is never a dead end) and the four practice modes (`practice.ts`, byte-identical with web). Typed mode passes "good" only on a word-for-word round, and the swipe gesture answers to the same check. No server change for the modes.

## 1.57.1 (versionCode 59) - 2026-09-12 - internal

**What's new (Play):**

- Keep a lifetime reading log, including rereads and partial passages. Log physical Bible reading and correct entries in chat.
- Reading stays saved through offline restarts and syncs when you reconnect. History loading now times out cleanly if your connection is unavailable.
- Includes the latest offline Learn, note templates, highlight labels, and related-passage improvements.

**Dev notes:** Combines the Windows study integration with the reviewed reading journal and encrypted offline account restoration. Supersedes the version 58 candidate with bounded history requests, retaining queued readings and account ownership through process death and expired tokens. Release artifacts must be rebuilt from this version's final commit; prior version 58 artifacts are not reused.

## 1.57.0 (versionCode 58) - 2026-09-12 - internal

**What's new (Play):**

- Offline Learn progress survives an app restart and syncs once when you reconnect.
- Your reading log keeps lifetime sessions and partial passages. Log physical-Bible reading or correct entries in chat.
- Note templates, Markdown copy, highlight labels, related passages, and continue-reading work together across your study screens.
- Includes the reviewed conversation-history improvements.

**Dev notes:** Integrates Kimi's completed workflow review (0571c73) with main's durable reading journal (d519d85). Offline Learn operations use revision checks and transactional receipts while preserving legacy result-only review requests. The receipt migration follows the already-applied reading-log migration. Account-scoped review and reading queues survive restarts and retries. Windows Store onboarding and Apple release validation remain separate. Encrypted Clerk resource caching preserves account identity during offline cold starts.

## 1.56.0 (versionCode 57) - 2026-09-12 - internal

**What's new (Play):**

- Learn a verse is ready. Tap a Bible verse, choose Learn this verse, and practice from the Bible tab.
- Practice moves from the full verse to missing words, then recall from the reference. Tap blanks for help.
- Downloaded verses support offline practice. Your saved schedule updates when you practice online.
- Includes the integrated conversation history, note templates, highlight labels, related passages, and continue-reading improvements.

**Dev notes:** Integrates Kimi's remaining Learn screens and completes the verse-sheet queue entry point on web and Android. Preserves KJV/NKJV source translation, removes provider HTML from practice text, and treats NKJV retrieval failures as errors instead of relabeling KJV. Includes the Windows installation/runbook documentation; Store submission remains separate.

## 1.55.1 (versionCode 56) - 2026-09-12 - internal

**What's new (Play):**

- SureWord knows your day: it greets you by name and sees today's cross, your week's reading and the verses you marked.
- Short follow-ups get short answers.
- Add to notes writes a real study note in your voice, not the chat reply.
- Chats name themselves; history gains search, rename and a safer delete.
- Tap a verse for related passages, name your highlight colours, continue where you left off, start notes from a template, and search either translation.

**Dev notes:** Supersedes versionCode 55, which was uploaded from a lane branch before the four client merges landed. This build is main at e982475: deferred notification permission (proven on the emulator - nothing at launch, the dialog appears on the first Pick Up Your Cross visit), conversation history search/rename/confirmed swipe-delete, the See also cross-reference row, highlight colour names that follow the account, continue reading on the Bible home, note templates, translation-aware reader search, and the receipts parser (cards render in a later build). Learn a verse is held back: the API shipped, the screens land once a verse can be added to the queue.

## 1.55.0 (versionCode 55) - 2026-09-12 - internal

**What's new (Play):**

- SureWord knows your day: it greets you by name and sees today's cross, your week's reading and the verses you marked.
- Short follow-ups get short answers.
- Add to notes writes a real study note in your voice, not the chat reply.
- Chats name themselves; history gains search, rename and a safer delete.
- Tap a verse for related passages, name your highlight colours, continue where you left off, start notes from a template, and search either translation.

**Dev notes:** Server-side work reached every installed build on deploy (name and day context in the prompt, short-follow-up hint, note composer on `POST /api/notes/append`, conversation auto-titles, `highlightVerse` / `organizeNote` tools, `GET /api/reading-events`, `GET /api/bible/crossrefs`, `highlightLabels` on the preferences document, and the tool-loop time budget that stopped slow turns being killed with the answer unsaved). This build carries the Android halves: deferred notification permission (first settled answer or first Cross visit), conversation history search/rename/confirmed swipe-delete, the See also cross-reference row, highlight colour names, continue reading on the Bible home, note templates, and the receipts parser (cards render in a later build). Learn a verse is held back: the API shipped, the screens land once a verse can be added to the queue.

**Dev notes:** Translation-aware KJV/NKJV phrase lookup, cancellation of superseded requests, explicit result provenance, and reference navigation. KJV matches remain available offline. Live provider regression checks cover the reported Job 1:8 phrase on web and Android.

## 1.54.0 (versionCode 54) - 2026-09-11 - internal

**What's new (Play):**

- Settings no longer shifts under your thumb. The AI Providers, My church and Memory sections are ready the moment the screen opens, so a fast scroll down to Check for updates lands where you meant to tap instead of on an Add key or Remove button.
- Settings stays ready between launches and refreshes quietly in the background.

**Dev notes:** New `mobile/src/features/settings/settingsData.ts`: a persisted, per-account store for `/api/providers`, `/api/church` and the `/api/memories` count, prefetched right after `adoptCacheOwner` at sign-in and revalidated in place on every Settings focus (stale-while-revalidate, one in-flight request per section under a 35s ceiling because the Clerk token step before the timed fetch can hang for good after an offline launch, generation-guarded and cleared with the other user caches). `ProviderSettingsSection` and `useChurchSection` read it instead of fetching on mount; their cold-cache placeholders now match the loaded height (one row per known provider) instead of an 80pt spinner. The `ScrollView` also sets `maintainVisibleContentPosition` as a backstop. The Memories screen reports its count so "N saved" is exact on the way back. Church request functions moved to `mobile/src/features/church/api.ts` (re-exported from `churchStore.ts`).

## 1.53.0 (versionCode 53) - 2026-09-07 - internal

**What's new (Play):**

- Ask about the original Hebrew and Greek: SureWord can now find every verse where a Hebrew or Greek word appears, by the word itself, its Strong's number, or how it is spelled in English (hesed, agape, shalom).
- The transcript shows "Searching the Hebrew and Greek" while it looks, and the verses land in the Retrieved Verses card.

**Dev notes:** The `searchOriginalLanguage` tool is server-side (Neon `OriginalVerse` table: WLC Hebrew + TR Greek, Strong's array GIN + consonantal/plain tsvector, aligned to KJV verse numbers where the versification is known) and already answers on every installed build; this release adds the Android activity label and routes the output through the existing retrieved-verses card. The Apple label is in source, uncompiled until the next Mac gate.

## 1.52.0 (versionCode 52) - 2026-09-07 - internal

**What's new (Play):**

- Chat can now look up exact Bible wording instantly: quote a phrase or name a word and SureWord finds every verse that contains it.
- The transcript shows "Searching the Bible for those words" while it looks, and the verses appear in the Retrieved Verses card.

**Dev notes:** The `findVerses` tool is server-side (Neon `KjvVerse` full-text index, commit 832d08e) and already works on every installed build; this release adds the Android activity label and routes the tool's output through the existing retrieved-verses card (`mobile/src/lib/chatView.ts`). The macOS/iOS label is in source (`macos/Shared/Chat/ChatViewMessage.swift`), uncompiled until the next Mac gate.

## 1.51.0 (versionCode 51) - 2026-09-07 - internal

**What's new (Play):**

- Bible search no longer pauses on your first search.
- Reading long chapters stays smooth while a verse explanation is loading.
- Chat keeps up with long conversations while an answer is streaming.
- Reading plan progress now updates everywhere at once: the Bible home card, the plan screen, and Pick Up Your Cross.
- Photos attach faster: large pictures are sized down before sending.
- Faster app launch.

**Dev notes:** KJV books pre-warm one per frame when Search mounts (`warmAllKjvBooks`); verse rows are a memoized `VerseRow` with a no-markup fast path in `parseBibleVerseMarkup`; the chat view-model reuses settled `UIMessage` conversions via a WeakMap (`toViewMessageCached`); reading plans live in one `planStore` (`useSyncExternalStore`, in-flight dedup, generation guard, cleared with the other caches on account change); notes hydration no longer re-persists, highlights skip identical chapter refreshes; seven non-first-frame fonts load after the splash gate; `reanimated-color-picker` is required lazily; photo picks over 2048px are resized and re-encoded as JPEG with `expo-image-manipulator` (new native dependency, prebuild required). No capability changes; PARITY.md untouched.

## 1.50.1 (versionCode 50) - 2026-09-06 - internal

**What's new (Play):**

- Ask SureWord to remember, update, or forget something directly in chat, with clear progress while it works.
- Requests to save both a note and a memory now do both. Memory actions respect your account and Memory setting.

**Dev notes:** Direct memory tools and success receipts are shared server-side, reaching existing clients after backend deployment. Authenticated ownership filters and serialized writes protect account isolation; explicit tool turns skip background extraction and stale extractions cannot overwrite newer memory state. Activity labels are mirrored across web, Android, and Apple source.

---

## 1.50.0 (versionCode 49) - 2026-09-06 - internal

**What's new (Play):**

- Pick Up Your Cross now stays in Bible navigation: return from a study passage to your devotional, then to the Bible home.
- Quick highlight color changes and removals save in the order you choose them.
- Note autosaves keep newer edits from being overwritten; a failed save stays available to retry before leaving.
- Larger touch targets make notification time and AI provider controls easier to use.
- Fixed a black screen after Android recreates the devotional screen.

**Dev notes:** Cross is nested under the Bible stack with an anchored legacy `/cross` redirect. Highlight writes serialize per verse and reject stale read/rollback results. Note captures and body saves share a queue with successful-save dirty tracking; primary tab changes flush before removing the editor. Settings controls use 48dp targets. Listen cleanup ignores only the native already-released-player error. Android experience evidence and remaining audit limits are recorded in `docs/android-experience-2026-09-06.md`.

## 1.49.0 (versionCode 48) - 2026-09-04 - internal

**What's new (Play):**

NEW
- Your settings now follow your account: Bible translation, parchment page, Listen speed, model picks, Memory and Web Search sync across phone, web and Mac, and return on a fresh install.
- Settings: a Web Search toggle on your phone.

FIXED
- Signing in with a different account no longer shows the previous account's cached notes, highlights or settings.

**Dev notes:** `GET/PATCH /api/preferences` is now the whole account document (`User.translation/parchment/listenRate` + the chat columns + both toggles). `preferencesSync.ts` hydrates on sign-in and on foreground (15 s throttle, editSeq stale-fetch guard), every settings setter writes through, the picker's house pin and defaults seeding stay local, and `sureword.cache-owner` keys the settings/notes/highlights caches to the account (cleared on sign-out; a first launch after upgrade pushes local non-default values up before hydrating).

## 1.48.0 (versionCode 47) - 2026-09-03 - internal

**What's new (Play):**

IMPROVED
- Chat: the model picker's search box is always there, finds models by any words in any order ("gpt sol", "claude opus", "openrouter"), ignores dots and dashes, and the keyboard's Search key picks the top match.

**Dev notes:** `SEARCH_THRESHOLD` dropped to 1 and `filterModels` became tokenized with label-first ranking (mirrored on web); `onSubmitEditing` selects the first result.

## 1.47.0 (versionCode 46) - 2026-09-03 - internal

**What's new (Play):**

NEW
- Chat: the model picker now shows what each model can do, with a search box, a short description and price per model, and Reasoning, Speed, Length and Mode options that only appear when the model supports them.
- Chat: reasoning goes from Off to Max on models that allow it, Fast mode is available on OpenAI, Claude Opus and OpenRouter, Brief/Normal/Detailed controls answer length, and Pro mode unlocks deeper reasoning on GPT-5.6.

**Dev notes:** Android half of the model-picker overhaul. New run options (`speed`, `verbosity`, `mode`) ride every chat request and persist as account defaults (`User.defaultSpeed/defaultVerbosity/defaultMode`); the sheet filters every chip through the model's own capability arrays from `GET /api/ai/models`. Server side, OpenAI calls no longer request reasoning summaries nobody rendered.

## 1.46.0 (versionCode 45) - 2026-09-02 - internal

**What's new (Play):**

FIXED
- Bible: the Ask AI button no longer sits on top of the verses, and the verse sheet's highlight colours are visible as soon as it opens.
- Chat: the conversation list no longer cuts off its last chat, and long book names in suggestions no longer split mid-word.
- Notes: long titles now read from the start in the editor.
- Settings: removed a stray empty button from the header.

IMPROVED
- Headers separate cleanly from scrolling content, and the sign-in wordmark is easier to read.

**Dev notes:** Android half of the 2026-09-02 UI uniformity audit (chapter-reader FAB opacity + reader bottom inset, BottomSheet scroll-mode bottom safe-area, HistoryModal list padding, Settings/Memory header spacer, note title tail-ellipsis, header hairlines, WelcomeState label column, BrandTitle 52 to 40). Server side, the model picker now hides models older than 180 days; that reaches every installed build without this release.

---

## 1.45.0 (versionCode 44) - 2026-09-02 - internal

**What's new (Play):**

FIXED
- Bible: the verse sheet now scrolls, so Expand with AI, Highlight, Copy, Share and Save to note are reachable again under the original-language words.

IMPROVED
- Tap-a-verse explanations open instantly for any verse someone has already tapped.

**Dev notes:** `BottomSheet` gained a `scroll` mode (88% max height, pinned title, ScrollView body) used by the verse sheet. Server side, `POST /api/verse-insight` now reads and writes a shared `VerseInsight` cache keyed on translation, reference, verse-text hash and prompt version; that part reaches every installed build without this release.

---

## 1.44.0 (versionCode 43) - 2026-09-02 - internal

**What's new (Play):**

NEW
- Original language: tap any verse in Bible to see the Hebrew or Greek words behind it. Tap a word for its meaning, pronunciation, Strong's number and definition.
- No API key needed: SureWord now answers every account with its built-in model, GPT-5.6 Luna. Add your own key in Settings to choose other models.

IMPROVED
- The model picker only lists models you can actually use.

**Dev notes:** New public routes `GET /api/bible/original` and `GET /api/bible/strongs` (edge-cached; the 18 MB texts stay on the server). `GET /api/ai/models` now carries `access` and a `house` block; keyless accounts run on the server OpenAI key at medium effort (low for tap-a-verse) and locked providers are no longer returned. Server-side changes reach every installed build; the APK carries the verse-sheet section and the house-mode picker sheet.

---

## 1.43.1 (versionCode 42) - 2026-08-31 - internal

**What's new (Play):**

FIXED
- Restored the Bible reader's original Scripture spacing and rendering for comfortable chapter reading
- Kept the new readable type system everywhere else in SureWord

**Dev notes:** The chapter body again uses React Native's original nested text renderer, Cormorant Garamond Scripture face, 1.55 line-height scale, and system-font verse numbers. The Atkinson type system remains unchanged outside the verse body.

---

## 1.43.0 (versionCode 41) - 2026-08-30 - internal

**What's new (Play):**

IMPROVED
- A more readable Atkinson Hyperlegible type system across Chat, Bible, Notes, and Settings
- Larger chat answers and clearer labels throughout SureWord
- Scripture keeps its distinctive reading style, while code and technical text now use Hack

**Dev notes:** Web and Android now share a semantic type scale. Android routes all normal text through shared Atkinson primitives, retains Pirata One for decorative headings and Cormorant Garamond only for validated Scripture, and bundles Hack offline for monospace content.

---

## 1.42.0 (versionCode 40) - 2026-08-30 - internal

**What's new (Play):**

IMPROVED
- Come hungry for the Word: a short, smooth Android opening now leads into SureWord's Scripture-centered welcome
- Your suggested questions are now clearly chosen from your reading, questions, notes, and memories
- 1 Peter 2:2 now frames the study experience across Android, web, Mac, and iPhone
- Returning from the background takes you straight back to where you left off without replaying the welcome

**Dev notes:** The welcome message leads with personalized Bible study companionship, keeps the Scripture-first trust statement secondary, and is guarded by cross-client copy parity tests. Android adds a two-second Remotion H.264 launch asset and a process-session guard so only true cold process starts play it.

---

## 1.41.0 (versionCode 39) - 2026-08-30 - internal

**What's new (Play):**

NEW
- Link notes together: type [[Note Title]] or use the link button in the editor toolbar
- Linked mentions: the new info panel shows every note that links to the one you are reading
- Note properties: give notes aliases and your own metadata (text, numbers, checkboxes, lists), plus creation date, word count and folder at a glance
- Links to notes that do not exist yet can be created with one tap

**Dev notes:** Wikilinks are parsed server-side from plainText into a NoteLink table (unresolved links carry a null target and self-resolve when the title appears); aliases/properties are new Note columns. Editor insert goes through tentap injectJS + execCommand at the caret. Notes cache key bumped to v2.

---

## 1.40.0 (versionCode 38) - 2026-08-28 - internal

**What's new (Play):**

IMPROVED
- The Chat question box now has balanced spacing above the navigation bar
- A lighter surface and subtle glow make the question box easier to see

**Dev notes:** The shared tab-bar metric now includes its vertical padding, preserving the intended composer gap. The native composer uses a stronger surface, border, and theme-aware halo.

---

## 1.39.0 (versionCode 37) - 2026-08-28 - internal

**What's new (Play):**

NEW
- SureWord now has a custom AI guide across Chat and Notes

FIXED
- Thinking and tool activity now stay in one clearly labeled assistant row
- Chat no longer shows duplicate AI avatars while an answer starts

**Dev notes:** Chat and Notes streams now open the persisted assistant id before status narration. Web, Android, macOS and iOS also discard legacy empty assistant shells and use the same guide artwork.

---

## 1.38.1 (versionCode 36) - 2026-08-28 - internal

**What's new (Play):**

NEW
- Connect your OpenRouter key in Settings → AI Providers
- Choose compatible OpenRouter models from the Chat model picker
- OpenRouter keys are validated and encrypted like your other AI provider keys

**Dev notes:** The shared SureWord API now authenticates OpenRouter keys, lists compatible models and routes chat, tools, files and structured background work through the official adapter.

---

## 1.38.0 (versionCode 35) - 2026-08-28 - internal

**What's new (Play):**

IMPROVED
- SureWord's AI answers now use the Bible translation you select
- Bible history is now clearly labeled Timeline, People & Places
- Listen clearly explains when self-service SureWord Pro access is not available yet

---

## 1.37.1 (versionCode 34) - 2026-08-27 - internal

**What's new (Play):**

FIXED
- Pick Up Your Cross no longer turns into an empty black screen while a different word is being prepared
- Your current word stays visible with a clear progress message, then the screen moves to the new verse when it is ready

**Dev notes:** The replacement POST takes tens of seconds under Sol xhigh. Android previously set `entry` to null while the user was scrolled to the bottom; the ScrollView retained that now-out-of-range offset after its content collapsed, producing an empty black viewport. The old day now stays rendered, an explicit progress panel replaces the button, errors are non-destructive, and the successful response scrolls to the new verse.

## 1.37.0 (versionCode 33) - 2026-08-27 - internal

**What's new (Play):**

IMPROVED
- Pick Up Your Cross now remembers what it has already covered and searches your current walk for a fresh, grounded direction
- Going deeper in Chat is recognized as follow-up study instead of making tomorrow repeat today
- Reopening Pick Up Your Cross refreshes the current day and its Listen transcript

**Dev notes:** Daily Cross selection is now a bounded GPT-5.6 Sol xhigh tool workflow over labelled personal context and hybrid KJV search, followed by deterministic 30-day verse and three-day theme validation and a Sol-high locked writer. New `VerseOfDay` provenance records theme/evidence/model/fallback state. The old unconditional John 3:16 fallback is replaced by a 50+ verse exclusion-aware pool. Android/web/Apple Go deeper flows attach server-validated message origin; Android refetches on route focus/app resume and remounts Listen when the stored day changes. Server changes reach installed builds when Vercel deploys; this APK carries Android provenance and refresh behavior.

## 1.36.0 (versionCode 32) - 2026-08-27 - internal

**What's new (Play):**

NEW
- Tell SureWord where you worship: Settings now has My church
- Search for your church by name or city and save it in a tap
- Your church card keeps its address, phone, website and directions one tap away
- Read your church's mission statement, taken from its own public website

**Dev notes:** Android half of "My church". New `mobile/src/features/church/`: `church.ts` (shared response shapes mirroring `src/lib/church-client.ts`, plus pure `shouldSearch` / `hostnameOf` / `needsMissionToggle` / `isLatestRequest` helpers with unit tests), `churchStore.ts` (`/api/church` calls through `apiJson` and the `useChurchSection` hook - 350ms debounce, monotonic request id to drop stale keystrokes since `apiJson` takes no abort signal, 60s timeout on the slow PUT that scrapes the church website, 404 mapped to "try another result"), and `ChurchSection.tsx` (search, results, saved-church card, mission clamp at 6 lines with Show more, Remove behind a destructive Alert). The section renders its own MY CHURCH heading so `status: "unavailable"` leaves no orphan label. `hostnameOf` is regex-based because React Native's URL polyfill does not implement `hostname` everywhere. Server routes are shared with the web app and reach installed builds without a release.

## 1.35.0 (versionCode 31) - 2026-08-26 - internal

**What's new (Play):**

NEW
- Browse Bible history through Timeline, People and Places
- Open people and events, follow person journeys, and trace reviewed relationships to their exact Scripture references
- Find the right Joseph, Mary, John or James with clearer search context

IMPROVED
- Faster era navigation, grouped search results and clearer traditional chronology labels

**Dev notes:** Timeline & People v2 adds native full-screen Android routes, People/Places directories, stable event lookup, cited typed relationships, person journeys, immediate-family views, trace connection, grouped search, strict chapter validation and refreshed offline atlas data.

## 1.34.0 (versionCode 30) - 2026-08-26 - internal

**What's new (Play):**

FIXED
- The era buttons on Timeline & People (All, Patriarchs, Exodus, Judges, Kingdom and the rest) are no longer cut in half - the whole row shows, and scrolls sideways as it should
- The folder and tag rows in Notes are protected from the same squeeze

**Dev notes:** The era row's horizontal `ScrollView` on `mobile/app/(app)/bible/timeline.tsx` had no `style` of its own, so it kept React Native's `baseHorizontal` default of `flexGrow: 1, flexShrink: 1`. Yoga measures a ScrollView's full intrinsic content even under `overflow: scroll`, so the tall event `FlatList` sibling made the column's free space negative and shrink was distributed by basis - the ~55px chip row lost ~42px and rendered as a ~13px sliver, matching the report. `flexShrink: 0` is the load-bearing half of the fix; `flexGrow: 0` alone does nothing once free space is negative, which is why `notes/index.tsx`'s existing `chipScroll: { flexGrow: 0 }` was vulnerable to the same squeeze and now sets both. Nothing above the row constrains it - `Screen` is a plain `flex: 1` SafeAreaView with no fixed height. Web needs no change: `src/components/atlas/AtlasScreen.tsx` renders the chips in a `flex flex-wrap` div in normal document flow under `min-h-[100dvh]`, with no fixed-height or `overflow-hidden` ancestor. Style-only, no native modules, so no prebuild.

---

## 1.33.0 (versionCode 29) - 2026-08-26 - internal

**What's new (Play):**

Listen keeps playing when your screen goes off.

The spoken devotional now works like your music app: put the phone down and it keeps going. You'll see it on your lock screen and in your notifications with today's verse - play, pause, skip back and forward, and drag to any point. Your headphone and car controls work too.

**Dev notes:** No new dependency - `expo-audio` 57 already runs Android playback through an `androidx.media3.session.MediaSessionService` (`expo.modules.audio.service.AudioControlsService`); it ships off. Three things turn it on and all three are required: the config plugin's `enableBackgroundPlayback: true` (adds `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and declares the service - **manifest change, so a prebuild is mandatory**), `setAudioModeAsync({ shouldPlayInBackground: true, interruptionMode: "doNotMix" })`, and `player.setActiveForLockScreen(true, metadata, { showSeekBackward: true, showSeekForward: true })` once loaded. The first flag is the actual bug fix: `AudioModule.OnActivityEntersBackground` pauses every player unless it is set, and a screen timeout backgrounds the activity. `doNotMix` is not cosmetic either - lock-screen controls hang off audio focus. Metadata updates go through `updateLockScreenMetadata`, not a second `setActiveForLockScreen`, which releases and rebuilds the session. Artwork is a public URL on the API host because the native loader uses a bare `java.net.URL` (no bearer token, no bundled-asset resolution). Skip is a fixed 10s - `SEEK_INTERVAL_MS` in the service, not configurable. `recordAudioAndroid` stays `false`; no `RECORD_AUDIO`. Web reached parity in the same change with `navigator.mediaSession` metadata plus seek handlers on `src/components/cross/ListenCard.tsx`. Both clients now take today's `reference` as a prop for the subtitle. Playback still ends if the card unmounts - `useAudioPlayer` releases the player with the component.

---

## 1.32.0 (versionCode 28) - 2026-08-26 - internal

**What's new (Play):**

IMPROVED
- Verses quoted in Chat always render as one Scripture card, with the reference inside it - no more split cards or stray symbols
- Chat answers reflow to your screen width, lists and code stay tidy, and a missing space after a period no longer turns into a web link
- Bible references tap through to the reader in more forms (Jn 3:16, Gen.1:1, John 3:16-4:2), and headings stay plain

**Dev notes:** Ships the Android half of commit `959d6ed` (assistant markdown rendering). The shared normalizer `mobile/src/lib/assistantMarkdown.ts` (byte-identical to `src/utils/assistantMarkdown.ts` below the header, asserted by test) tracks open blockquote/list containers instead of testing one previous line, so a bare `>` spacer, a lazy continuation, `>>` nesting or a wrapped list item no longer gets a blank line injected that split the Scripture card in two (4 of 292 production answers). Also: no 4-space list promoted to a code block; fences tracked by char + run length incl. `~~~`, quoted and indented code; `[FOLLOWUP]` stripping line-anchored and fence-aware; half-typed `**`/backtick trimmed at the stream head; model `<br>`/inline HTML normalized safely; CRLF/CR/tabs normalized. 97 shared vectors in `tests/fixtures/assistant-markdown-corpus.json` plus a 200-position stream-cut sweep run in vitest. Renderer (`markdownRules.ts`, `MarkdownBody.tsx`, `verseLinks.ts`, `NoteMarkdown.tsx`): softbreaks reflow outside blockquotes, blockquote last child flush, linkify 2-letter ccTLDs on a keep-list (no be/in/me/us) so `God.It` is plain text, verse links skip headings/th and accept `Jn 3:16` / `Gen.1:1` / `1Cor 5:17` / cross-chapter ranges, streaming re-parse coalesced to 80ms, `defaultImageHandler={null}`, notes AI panel normalizes and memoizes like chat. The server half (paragraph-joined persistence, `metadata.modelId`, MARKDOWN OUTPUT RULES in the chat and notes prompts, line-anchored `[FOLLOWUP]` extraction) is already live and reaches every installed build. No native modules, so no prebuild.

---

## 1.31.0 (versionCode 27) - 2026-08-26 - internal

**What's new (Play):**

NEW
- Timeline, People & Places: walk Bible history era by era and tap any event for what happened, in Scripture's own words
- Look up any person or place, or tap the people icon in a chapter to see who is in it
- Listen is ready when your day is: the spoken devotional is prepared with your Pick Up Your Cross (SureWord Pro)
- Playback speed from 0.75x to 2x, remembered for next time

**Dev notes:** New hand-authored atlas at `src/data/bible-atlas/` - 207 events, 183 people, 93 places, 1,177 references - mirrored to `mobile/src/data/bible-atlas/` (and `atlas-core.ts` to `mobile/src/features/atlas/atlasCore.ts`) by `node scripts/build-bible-atlas.mjs`, which is also the validator: it exits non-zero unless every reference resolves against the bundled KJV **and** every person/place is actually named in one of the verses it cites, which is what stops invented Scripture. Dates are the traditional Ussher chronology the KJV margins carry, marked "c." and labelled as such in the UI and in the prompt. All ranking, era grouping and reference parsing lives in one dependency-free module copied verbatim to the phone, so the two clients can't drift; `tests/bible-atlas.test.mjs` (node) and `mobile/src/features/atlas/atlas.test.ts` (vitest) both cover it, including a drift check on the mirrored copies. Android reads the bundled JSON locally (works offline, like the reader); web reads the same data over `GET /api/bible/atlas` (`?q=` search, `?id=` entity, `?book=&chapter=` who's-in-this-chapter) and `GET /api/bible/atlas/timeline` so the browser never downloads the atlas. Two read-only chat tools (`lookupBibleEntity`, `getBibleTimeline`) plus a `/who` slash command; the prompt now tells the model to prefer them over `webSearch` for every who/where/when question. Pure JSON and TypeScript - no native modules, so no prebuild is required.

**Dev notes:** Three changes shipping together.

(1) **Playback proxy.** New `GET|HEAD /api/verse-of-day/audio/stream` streams the private blob through our own origin with `Range` forwarded both ways. Chrome's media loader never loads a presigned private-blob URL - `readyState 0` / `networkState 2`, no `error` event, forever, in our `<audio>` and in Chrome's own tab player - while `fetch`/`curl` of the same URL succeed and a `blob:` URL of those bytes plays instantly; HEAD on it 403s because the signature is method-bound. The payload gained `streamUrl` (relative) alongside `url`; nothing hands `url` to a player any more. Web plays it same-origin; Android passes the Clerk bearer token through `AudioSource.headers`, minted fresh because a session token lives ~60s and the player only proves it when it opens its connection - a stall spends one fresh-token rebuild, resuming in place, before any failure card. Status/headers are decided by the upstream's `Content-Range`, never by the requested range (`devotionalStreamResponseInit`, tested).

(2) **Generated with the day, not on a tap.** `scheduleDailyCrossAudio` (`waitUntil`) runs at every point a cross is stored: the on-demand `GET /api/verse-of-day/today`, `replaceDailyCross` (so the "a different word" control and the `setDailyCross` chat tool both get it - hooked inside the lib, via a dynamic import to avoid a module cycle), and the morning cron, which narrates **after** the pushes are away, sequentially, capped at 60 per run and bounded by a 240s budget so a slow narration can never cost anyone their notification. Idempotent throughout: `getOrCreateDailyCrossAudio` reuses a ready row and a pending row under three minutes old, and audio is keyed to the `VerseOfDay` id, so it is exactly one narration per day and one more for a replaced day. The clients lost their "tap to generate" button entirely - `listenPhase` has no `idle` state now, and POST survives only behind "Try again". **Server-side, so it reaches every installed build without a release**; the client half needs this build.

(3) **SureWord Pro gating.** New `User.plan` column (migration `20260826200000_user_plan`, defaults `'free'`, not yet applied). `src/lib/entitlements.ts` resolves Pro from that column OR the `PRO_USER_IDS` env allowlist (same convention as `SERVER_CREDENTIAL_USER_IDS`, shared parser); pure rules in `entitlements-rules.ts` so `resolvePlan` is unit-tested. `readDailyCrossAudio` / `getOrCreateDailyCrossAudio` / `scheduleDailyCrossAudio` / the stream route all answer `"locked"` **before** any database write, model call or ElevenLabs request, and the cron narrates for Pro accounts only - a free account costs nothing. Both clients render an identical lock panel with no button (there is nowhere for one to go until billing exists). `GET /api/preferences` now also returns `plan`. Speed control persists per client (web `localStorage`, Android settings store) and uses `player.setPlaybackRate(rate, "high")` with `shouldCorrectPitch`; elapsed/total stay in real seconds. Web ships all three in the same release; macOS/iOS have none of Listen yet. No native modules, so no prebuild.

---

## 1.30.0 (versionCode 26) - 2026-08-26 - internal

**What's new (Play):**

NEW
- Timeline, People & Places. Tap Timeline & People on the Bible tab and walk Bible history from Creation to Revelation, era by era
- Tap any event for what happened, in the Bible's own words, with the verses one tap away
- Look up any person or place: what Scripture says, the other names it uses, who they connect to
- Reading a chapter? Tap the people icon to see who's in it
- Ask SureWord "/who Melchizedek" and it answers from the King James text, not the web

**Dev notes:** New hand-authored atlas at `src/data/bible-atlas/` - 207 events, 183 people, 93 places, 1,177 references - mirrored to `mobile/src/data/bible-atlas/` (and `atlas-core.ts` to `mobile/src/features/atlas/atlasCore.ts`) by `node scripts/build-bible-atlas.mjs`, which is also the validator: it exits non-zero unless every reference resolves against the bundled KJV **and** every person/place is actually named in one of the verses it cites, which is what stops invented Scripture. Dates are the traditional Ussher chronology the KJV margins carry, marked "c." and labelled as such in the UI and in the prompt. All ranking, era grouping and reference parsing lives in one dependency-free module copied verbatim to the phone, so the two clients can't drift; `tests/bible-atlas.test.mjs` (node) and `mobile/src/features/atlas/atlas.test.ts` (vitest) both cover it, including a drift check on the mirrored copies. Android reads the bundled JSON locally (works offline, like the reader); web reads the same data over `GET /api/bible/atlas` (`?q=` search, `?id=` entity, `?book=&chapter=` who's-in-this-chapter) and `GET /api/bible/atlas/timeline` so the browser never downloads the atlas. Two read-only chat tools (`lookupBibleEntity`, `getBibleTimeline`) plus a `/who` slash command; the prompt now tells the model to prefer them over `webSearch` for every who/where/when question. Pure JSON and TypeScript - no native modules, so no prebuild is required.

---

## 1.29.0 (versionCode 25) - 2026-08-26 - internal

**What's new (Play):**

NEW
- Reading plans. Tap Reading plan on the Bible tab: the Gospels in 30 days, Psalms & Proverbs in 31, the New Testament in 90, the whole Bible in a year - or say what you want and SureWord builds it
- Progress fills itself in. Read the chapters in SureWord and the day ticks itself off; Mark read covers reading you did elsewhere
- See your streak and how far through you are, and tap today's chapters to start
- Pick Up Your Cross now follows today's plan reading

**Dev notes:** New `ReadingPlan` + `ReadingPlanCompletion` tables (migration `20260826150000_reading_plans`); plan days are stored as JSON `[{ day, readings: [{ book, chapter }], focus }]`. Routes: `GET`/`POST /api/reading-plans`, `POST /api/reading-plans/[id]/days/[day]`, `DELETE /api/reading-plans/[id]`. **No progress is stored** - a day is done when every chapter of it has a `ReadingEvent` at or after the plan's `startDate`, so the reading events the reader already posts are the whole mechanism; `ReadingPlanCompletion` is only the by-hand escape hatch. The four presets are GENERATED from the KJV chapter table in `src/lib/reading-plan-presets.ts` (mirrored from `src/data/books.json`, asserted by `tests/reading-plans.test.mjs`), never hand-typed, and `splitEvenly` spreads the longer days through the plan instead of stacking them at the front. A written plan is one structured utility-model call grounded in `loadStudyContext`, with every book and chapter validated against the canon before storage. One live plan per user, enforced in `startPlan` (starting archives the previous one). `loadStudyContext` gained a `planBlock` and `daily-cross.ts` now instructs that the study path IS today's plan reading unless the user pinned or steered the day - that half is server-side and reaches every installed build without a release. Three chat tools (`getReadingPlan`, `startReadingPlan` with a `confirmed` flag like `setDailyCross`, `markReadingPlanDay`) plus a `/plan` slash command. Web ships the same screen in the same release; macOS/iOS do not have it yet. No native modules, so no prebuild is required for this one.

---

## 1.28.0 (versionCode 24) - 2026-08-26 - internal

**What's new (Play):**

NEW
- Listen to today's Pick Up Your Cross. Tap Listen and SureWord prepares a spoken devotional on your verse - it reads the verse, why it was chosen for you today, what the passage opens up, your study path, a prayer, and the question to carry
- Play, pause and scrub through it, and open Read along to follow the words

**Dev notes:** New `GET`/`POST /api/verse-of-day/audio`. The script is one structured utility-model call sharing `PERSONA` with `daily-cross.ts`, built from the stored day plus `loadStudyContext`, the verses either side, and up to five cross-references - all KJV wording from the bundled corpus, never the model. ElevenLabs `eleven_multilingual_v2` narrates it (`mp3_44100_128`) and the MP3 lands in **private** Vercel Blob at `daily-cross-audio/<userId>/<verseOfDayId>.mp3`; clients get a freshly signed URL per read. Seven nullable audio columns on `VerseOfDay` (migration `20260826120000_daily_cross_audio`). Generated on FIRST TAP only, never by the cron - ElevenLabs bills per character and most users never press play; a `pending` row under three minutes old is reused so two clients never buy two narrations. Signed URLs last 24 hours (`createAttachmentPreviewUrl` gained an optional `expiresInSeconds`, default unchanged for every other caller) and both clients re-sign once and resume in place if playback fails on a URL older than ten minutes. With no `ELEVENLABS_API_KEY` the routes answer `status: "unavailable"` before touching the database and both clients render nothing at all - so until the key is set in Vercel this build simply shows no Listen card. Android uses `expo-audio` (**native module: needs a prebuild, which this build is**) with the plugin pinned to `recordAudioAndroid: false` so no microphone permission appears on the listing. Web ships the same card in the same release; macOS/iOS do not have it yet.

---

## 1.27.0 (versionCode 23) - 2026-08-26 - internal

**What's new (Play):**

NEW
- Every question on the welcome screen now says where it came from - the passage it is about, or a tag like YOUR NOTES, TODAY'S VERSE or NEXT CHAPTER

IMPROVED
- Scripture references on those questions read the same way every time

**Dev notes:** `GET /api/suggested-questions` now returns `{ questions: string[], items: { question, label }[], personalized }`. `questions` is unchanged on purpose - 1.26 and earlier (and the shipped macOS DMG) read that key and filter out anything that is not a string, so moving it to objects would have dropped every installed user back to the static six with no error at all; the labels ride in `items`, same order. The generator asks the model for a label with every question and keeps it only if it is a fixed kind (MEMORY, YOUR NOTES, TODAY'S VERSE, APPLY, NEXT CHAPTER, DOCTRINE) or parses whole as a Scripture reference; otherwise it falls back to a reference found in the question text, and to no label at all rather than a guess. Sets stored before labels existed keep serving through the same fallback, so nothing waits for the day to roll over. Web ships the same labels in the same release; macOS/iOS keep reading `questions` only.

---

## 1.26.0 (versionCode 22) - 2026-08-26 - internal

**What's new (Play):**

NEW
- Chat opens with a stained-glass Scripture welcome and a short animated launch
- Your personalized study questions still come from your reading, chats, notes and memories

IMPROVED
- Your strongest next study question is featured first, with every other generated question ready below it

**Dev notes:** The Android welcome state now uses the generated stained-glass manuscript artwork, an illuminated 2 Peter 1:19 treatment, and a 2.8-second Remotion launch video through `expo-video`. The existing suggested-question API is unchanged; presentation tests verify that every generated question remains in its original order.

---

## 1.25.0 (versionCode 21) - 2026-08-25 - internal

**What's new (Play):**

IMPROVED
- When something goes wrong in Chat, SureWord now explains what happened in plain language and offers a Try again button when retrying can help - no more technical noise.

FIXED
- A question could rarely fail to send without any message at all. You'll always see what happened and can retry.

**Dev notes:** Server now returns coded errors ({error, code}) from ask-question/note-ai, mid-stream errors carry a [code] prefix, raw exception text no longer leaks into 500s, and ask-question is rate-limited (20 req / 5 min per user, 429 + Retry-After) - server-side, reaches every installed build without a release. Clients classify errors into titled, retryable cards with a ref code; a failed conversation create now aborts the send with a retry instead of silently shipping an unrecoverable message.

---

## 1.24.0 (versionCode 20) - 2026-08-25 - internal

**What's new (Play):**

FIXED
- Leaving the app while SureWord is answering no longer loses the answer. Switch apps, lock your screen, or drop off Wi-Fi - the answer keeps being written and is waiting for you when you come back.

NEW
- SureWord can tell you when an answer is ready if you left while it was thinking. Tap the notification to jump straight back to that conversation. Turn it off in Settings under Chat.

**Dev notes:** the server now drains its own copy of the answer stream (`consumeSseStream`), so a client disconnect can no longer cancel generation or persist a truncated reply - this is a server change and reaches every installed build without a release. The clients collect the finished answer from the conversation when their stream dies (Android on app resume, web on tab focus), and Android suppresses the "ready" push for an answer the user deliberately stopped. Push tokens now stay registered when the Verse of the Day is switched off, so the two notification streams are independent (`PushToken.chatReplies`).

---

## 1.23.0 (versionCode 19) - 2026-08-24 - internal

**What's new (Play):**

FIXED
- Attaching a PDF or image no longer breaks the chat. Whatever AI model you have picked, SureWord now reads your file - and if your model genuinely cannot, it tells you instead of failing the whole answer. Retrying a failed answer works again too.

NEW
- SureWord can now see the verses you have highlighted. Ask "what have I highlighted in Romans?" and it will read your highlights, colors and all.

**Dev notes:** Server-side, so both fixes reach every installed build through the API. `resolveModel` gained `requireAttachments`: a thread carrying file parts falls back to the first attachment-capable model the user holds credentials for (`ATTACHMENT_CAPABLE_MODEL_IDS`), narrated as a status line; with none available, file parts are replaced by a text note rather than sent to a provider that 400s on them (the Moonshot Kimi K3 `invalid part type: file` failure). `ask-question` now answers the last *user* message instead of rejecting arrays that end on an assistant turn (regenerate's shape), and surfaces `APICallError` as actionable text. New read-only `getHighlights` tool over `VerseHighlight` (`src/lib/highlights.server.ts`) with KJV text + color names; activity label added to all three clients.

## 1.22.0 (versionCode 18) - 2026-08-23 - internal

**What's new (Play):**

NEW
- SureWord now shows you what it's doing while it works: "Getting ready", "Reading your document", "Searching the Scriptures" and more appear live from the moment you send, in Chat and in the Notes assistant - no more silent waiting dots

IMPROVED
- Clearer messages when something goes wrong, without technical noise

**Dev notes:** Server streams `data-status` UI-message parts (stable id, first frame on the wire) from `createUIMessageStream` in ask-question + note-ai: pre-flight narration, `onToolExecutionStart/End` tool labels via shared `src/lib/tool-activity-labels.ts`, and `experimental_download` PDF narration; parts stripped before persistence. Clients split status vs tool activity (status clears once answer text streams), `throttle: 50` on all four hooks, `UserFacingError`/`AiCredentialError` allowlist masks internal stream errors (logged server-side). E2E-proven against the real route with raw SSE captures.

## 1.21.0 (versionCode 17) - 2026-08-22 - internal

**What's new (Play):**

NEW
- Highlight any verse in the Bible reader: tap a verse, pick one of 8 colors or choose any custom color, and it stays highlighted - synced across Android, web, and Mac

**Dev notes:** `VerseHighlight` table + `GET/PUT/DELETE /api/highlights` (shared backend, keyed per translation/book/chapter/verse, `#RRGGBB` color); mobile store `src/features/bible/highlightsStore.ts` (AsyncStorage cache + optimistic sync), swatch row + reanimated-color-picker custom picker in the verse sheet; web + macOS/iOS shipped in the same release.

## 1.20.0 (versionCode 16) - 2026-08-20 - internal

**What's new (Play):**

NEW
- SureWord keeps itself up to date: new versions download from the Play Store automatically, and Settings gains a "Check for updates" button

IMPROVED
- Solid bottom navigation bar - content no longer shows through it
- Crisp new icons across Notes, Chat and Bible instead of emoji
- Your personalized starting questions now load instantly, prepared fresh each morning

**Dev notes:** Play Core in-app updates via sp-react-native-in-app-updates (`src/features/updates/inAppUpdates.ts`): FLEXIBLE auto-flow at launch (self-installs on download), IMMEDIATE flow behind Settings → Check for updates; no-ops on sideloaded/dev builds. Tab bar drops expo-blur (Android renders it as plain translucency) for an opaque docked bar in `app/(app)/_layout.tsx`. Emoji glyphs → Ionicons via `GlyphButton`/`SheetRow` `icon` prop. Server: `SuggestedQuestionSet` table + `getSuggestedQuestions` day-cache, pre-warmed by the verse-of-day cron; the speedup reaches every installed build via the API, the APK carries the visuals.

## 1.19.1 (versionCode 14) - 2026-08-20 - internal

**What's new (Play):**

NEW
- Sign in with a password: accounts that have a password set are asked for it directly, with "Email me a code instead" as a fallback

IMPROVED
- The sign-in button now reads "Continue" and picks the right next step for your account

**Dev notes:** Password first-factor support in `app/(auth)/sign-in.tsx` for the Play review demo account (reviewers cannot read a one-time-code inbox). `onContinue` runs `signIn.create`, prefers the `password` factor when the account has one, else falls back to the email-code flow; new password step UI with code fallback. Web needs no change - Clerk's `<SignIn>` handles password automatically now that the account has one. Supports the App access declaration in Play Console.

## 1.19.0 (versionCode 13) - 2026-08-19 - internal

**What's new (Play):**

NEW
- The Bible reads like a scroll: verses move over real parchment - aged golden paper in light mode, a deep leather-dark sheet in dark mode
- Settings → Appearance → Parchment reader turns it off and returns the plain reader

### Added
- **The Bible reads like a scroll now.** The reader's page is real parchment:
  photorealistic aged golden paper in light mode, a deep leather-dark sheet
  in dark mode (following the app's theme setting), with sepia and gold ink
  tuned to each. The verses scroll over the fixed paper like text moving
  across an unrolled scroll. Textures are generated from the day-star
  pipeline (`scripts/generate-parchment.mjs`); web ships the same surface in
  the same release.
- **Settings -> Appearance -> Parchment reader** turns it off and returns
  the plain reader (on by default; web has the same toggle).

## [1.18.0] - 2026-08-19

### Added
- **The assistant can now edit your notes, not just write into them.** Ask it
  to reformat, reorganize, or clean up any note and it reads the whole note
  first, rewrites it faithfully, and confirms. It can also read your notes in
  full and find them by meaning, not just wording ("that note about talking
  to my kids about prayer"), so past study informs new answers.
- **Original-languages word study, grounded in real data.** The assistant now
  quotes the actual Hebrew (Westminster Leningrad Codex) and Greek (Scrivener
  1894 Textus Receptus, the text underlying the KJV) word by word, with
  Strong's numbers, morphology, and KJV glosses, instead of answering Greek
  and Hebrew questions from memory.
- **Cross-references on tap.** A curated cross-reference set (openbible.info,
  Treasury-style) lets the assistant trace a verse across all of Scripture
  with exact KJV text.
- Streaming activity labels for the new tools ("Reading your note",
  "Rewriting your note", "Tracing cross-references", "Opening the original
  text", "Studying the original word").

### Fixed
- **Bible references and retrieved verses are back.** Scripture search had
  been silently broken since Aug 13: the AstraDB free tier hibernated the
  vector database (and scheduled it for deletion). Verse embeddings now live
  in the same production Neon Postgres as everything else (pgvector), with a
  keyword fallback so retrieval can never silently vanish again. Answers also
  quote key verses as proper blockquotes on every model, not just some.

All of the above is server-side and reaches every installed build
immediately; only the new activity labels need this APK.

## [1.17.1] - 2026-08-19

### Fixed
- **Back now takes you back.** The back button used to dump you on Chat from
  almost anywhere — Pick Up Your Cross, Settings, Memories, a note opened from
  chat — because the tab navigator treated Chat as the fallback destination.
  Back now returns to the screen you actually came from (Cross → Bible,
  Memories → Settings, and so on).
- **The Notes tab opens the notes hub again.** Leaving the Notes tab resets it,
  so tapping Notes always shows all your notes instead of whichever note you
  had open last.
- **Back from inside a note goes to the notes hub**, never to chat — even when
  the note was opened straight from a chat card.

## [1.17.0] — 2026-08-19

### Changed
- **The notification now leads with the Scripture itself.** The body shows the
  verse text — *"Casting all your care upon him; for he careth for you." —
  1 Peter 5:7* — instead of the reference plus an explanation line; the
  why-today line waits on the screen the tap opens.
- **It arrives like it matters.** The daily notification now comes through a
  heads-up channel (banner + sound, like a text message) rather than sliding
  silently into the tray, and it wears the day-star mark in SureWord gold in
  the status bar instead of a generic tinted square.

### Known issue
- **Tapping the notification when the app is closed still opens the app to
  Chat instead of the day.** The app now checks for the launching tap on
  startup, and taps while the app is running deep-link correctly — but when
  the tap itself starts the app, Android hands the app no record of the tap
  (an expo-notifications bug, confirmed on-device with instrumentation: the
  response never reaches the app's code by either API). Needs an upstream fix
  or a native workaround in a future release.

## [1.16.0] — 2026-08-17

### Changed
- **The opening questions are now yours.** The six prompts on the empty chat
  screen used to be the same six for everybody ("What is the story of
  creation?"). They are now drawn from your own walk — the chapters you have
  been reading, what you have already asked, your notes, what SureWord
  remembers about you, and the verse you were given today — so opening the app
  puts your real next questions in front of you, ready to tap. They are written
  as questions *you* would ask, and sending one works exactly as before.
  Softly glowing placeholders appear while they are being prepared (once per
  session), and a brand-new account still gets the classic six.

## [1.15.0] — 2026-08-17

### Added
- **SureWord knows SureWord.** The assistant now carries the app itself in its
  head — the Bible reader and tap-a-verse, notes and folders, memory, settings,
  the model picker, and Pick Up Your Cross. Ask it "what can you do?", "how do
  I change my translation?" or "what's my cross today?" and it answers from
  what the app actually has, rather than guessing.
- **Ask for a different word.** You can now ask SureWord in chat to change
  today's Pick Up Your Cross — a new word, one centred on something specific
  ("something on patience"), or built on a verse you name. It always tells you
  what would be replaced and waits for your yes first, then shows a receipt
  card that opens the new day. `/cross` shows today's word without touching it.
- **↻ A different word for today** on the Daily Cross screen: confirm, and
  optionally type what the new day should centre on, and the day is prepared
  again in place — and the verse it replaces is not handed straight back.

## [1.14.0] — 2026-08-17

### Added
- **Pick Up Your Cross — your guided daily walk** (Luke 9:23: *"take up his
  cross daily"*). Each morning, an AI prepares a whole day around one verse
  chosen for you — from the chapters you've been reading, your recent chats,
  your notes, and your saved memories. A morning notification (on/off toggle
  and delivery hour in Settings → Verse of the Day) opens the new Daily Cross
  screen: the verse, **why it was chosen for you today** (grounded only in
  what you've actually been doing — never invented), how it applies to your
  walk, a short study path with tappable passages, and one question to carry
  through the day, plus a "Go deeper in chat" button. Also reachable any time
  from the ✝ card at the top of the Bible tab, and at sureword.app/cross on
  the web. Remote push arrives once FCM is configured; until then the app
  schedules the morning notification locally on your device, so it works
  today.
- **Reading history.** The reader now privately records the chapters you read
  (after a few seconds on screen, stored on the server under your account) so
  the daily verse — and future personalization — reflects where you actually
  are in the Word.

## [1.13.0] — 2026-08-16

### Added
- **Tap-a-verse.** Tapping any verse in the Bible reader now opens the verse
  sheet and immediately streams a short AI explanation of that verse — what it
  says in context and why it matters — generated with your selected model. A
  softly glowing skeleton shows while the model thinks, and explanations are
  cached for the session so re-tapping a verse is instant. The sheet keeps
  Copy, Share, and Save to note, and a new **✦ Expand with AI** button hands
  the verse to chat exactly like the old "Ask AI about this verse" action.
  Long-press still opens the same sheet. (Web ships the same experience.)

## [1.12.0] — 2026-08-13

### Changed
- **The model picker now shows every model your API key unlocks.** Models are
  grouped by provider — tap OpenAI, Anthropic, or Moonshot to expand its list,
  fetched live from the provider itself (GPT-5.6 Terra, Sol, Luna, GPT-5,
  Claude Opus 5, and anything the provider adds later — no app update needed).
  Providers without a key stay locked with a pointer to Settings → AI
  Providers. Reasoning effort is only sent to models that support it.

## [1.11.1] — 2026-08-13

### Fixed
- **Gboard screenshots now paste directly into the chat composer on Android 12+.**
  Selecting an image from Gboard's clipboard now creates a normal SureWord
  attachment and uploads it through the existing private attachment pipeline.
  The manual Add attachment → Paste screenshot action remains available on all
  supported Android versions.

## [1.11.0] — 2026-08-12

### Added
- **Choose your AI model and reasoning depth.** A new sparkles button in the
  chat header opens a model picker: GPT-5.6 Terra, Claude Opus 5, Claude
  Sonnet 5, and Kimi K3, plus an Auto/Low/Medium/High reasoning selector.
  Your pick becomes the account default across Android, web, and macOS.
- **Bring your own API keys.** Settings → AI Providers lets you connect your
  own OpenAI, Anthropic, or Moonshot (Kimi) key. Keys are validated with the
  provider, stored encrypted, and unlock that provider's models in the picker.
  Models without a key show locked with a pointer to Settings.

## [1.10.0] — 2026-08-11

### Added
- **Attach images and study files directly to chat.** Take a photo, select up
  to five images, choose a PDF/TXT/Markdown/CSV/JSON file, or paste a
  screenshot from the clipboard. SureWord can answer from the attachment even
  when the message has no typed text.
- **Private, durable attachment history.** Files are stored in a private Vercel
  Blob store, reopened with short-lived signed links, and restored with the
  conversation on Android and web. Deleting the conversation removes its
  stored files too.

### Fixed
- **The Android bottom bar is a normal three-destination app nav again.** It
  now shows only Chat, Bible, and Notes with consistent icons and active-state
  treatment; push-only Settings and Memories routes cannot leak into it.
- **The attachment source menu matches SureWord instead of Android's stock
  Material alert.** Camera, library, file, and clipboard actions now live in a
  dark branded bottom sheet.
- **NKJV supplied words render as italics instead of raw HTML.** Inline
  `<i>...</i>` markup is converted into the loaded Scripture italic face and
  stripped from copied, shared, saved, and Ask AI text.

### Security
- Uploads use exact-path, size-limited signed URLs and are downloaded again by
  the server for MIME, extension, size, signature, UTF-8, and JSON validation
  before the model can see them. Client-provided file URLs are never trusted.

## [1.9.0] — 2026-08-11

### Added
- **SureWord can now remember you.** A new Memory section in Settings carries
  the ChatGPT-style memory feature: as you chat, SureWord learns the things
  worth holding onto — who you are, what you're praying about, what you're
  studying — so later answers start from knowing you instead of from zero.
- **An "Enable memory" switch, and off really means off.** Turn it off and
  SureWord stops both using what it remembers and learning anything new —
  but nothing is thrown away. Your saved memories are kept untouched, waiting
  for whenever you turn it back on.
- **A Manage memories screen, because it's your memory, not ours.** From
  Settings you can see everything SureWord has saved, grouped by what it's
  about; ask for an AI-written summary of the whole picture; add a memory by
  hand; delete any single one; or clear the lot in one tap. Nothing it
  remembers is hidden from you.

## [1.8.2] — 2026-08-10

### Fixed
- **Tapping a second verse in a chat answer opens the right chapter.** Only the
  first "Read" worked per app session: every later one dropped you back on the
  chapter you had opened first, with nothing highlighted. `bible` is a nested
  stack, so the reader stays mounted once opened and a second deep link reuses
  it and merely updates its params — but the screen read those params only in
  its `useState`/`useRef` initializers, which run at mount and never again. The
  params are now what the reader renders, and chapter paging goes through
  `router.setParams` so they always describe what is on screen.
- **The verse highlight fires on every deep link, not just the first.** The
  scroll-and-flash was armed by a one-shot flag; it is now keyed by the
  reference, and gated on the loaded chapter matching the requested one. Params
  change a render before the new text arrives, and in that gap the effect used
  to burn its guard on the incoming verse while the previous chapter's text was
  still on screen — so the flash never ran once the right chapter loaded.
- Chapter loads can no longer land out of order. Two loads racing (paging fast,
  or deep-linking mid-fetch) could paint the loser's text, since NKJV is fetched
  over the network and the slower response is not always the older request.

## [1.8.1] — 2026-08-10

### Changed
- **New logo.** The old mark was a brain wired into a book — a VerseMind idea,
  since "mind" was the name. SureWord is from 2 Peter 1:19 ("a light that
  shineth in a dark place, until the day dawn, and the day star arise in your
  hearts"), so the mark is now the day star rising over the open Word, its rays
  doubling as the pages. Gold on the app's own near-black.
- The launcher, adaptive, splash, and chat-home icons all come from that one
  master now, so they can no longer drift apart between releases.

## [1.8.0] — 2026-08-10

### Fixed
- **Sign-in works again.** The app shipped a Clerk publishable key encoding
  `clerk.bible-ai-explorer.vercel.app`, a host that no longer resolves, and it
  still passed a `proxyUrl` pointing at the `/__clerk` proxy that was deleted
  when Clerk moved to its own domain. Both are gone: the app now uses the
  production key for `clerk.sureword.app` and lets Clerk reach its Frontend API
  directly, the way a custom-domain instance is meant to work.
- The API base URL now points at `https://sureword.app` instead of the legacy
  `bible-ai-explorer.vercel.app` host.

### Changed
- **The app is now SureWord on the device, not just in the code.** The native
  project was a stale prebuild still carrying `com.spragginsdesigns.versemind`
  and a launcher reading "VerseMind" — the earlier rename only ever touched
  `app.json`. Regenerated it, so the package is now
  `com.spragginsdesigns.sureword` and the launcher reads **SureWord**.
- Dropped the obsolete `edgeToEdgeEnabled` flag (Android 16 makes edge-to-edge
  mandatory and Expo now warns on it).

> **Upgrading:** the package name changed, so this installs alongside the old
> VerseMind app rather than over it. Uninstall VerseMind after confirming
> SureWord signs in.

## [1.7.0] — 2026-08-10

### Added
- **Settings.** A new gear (⚙) button in the chat header opens a Settings
  screen with three sections:
  - **Appearance** — System / Dark / Light. The whole app (every screen,
    sheet, editor, and the tab bar) now follows the choice; System tracks the
    phone's own dark or light mode. `userInterfaceStyle` is now `automatic`.
  - **Bible translation** — a persisted KJV/NKJV default shared with the
    Bible reader's chips and used as the chat verse-attachment fallback.
    (VerseMind's AI answers still quote the KJV by design.)
  - **Account** — your profile and a Sign out button, which the app has
    never had (previously only the web client's Clerk menu could sign out).
- Settings persist across launches (AsyncStorage, hydrated before the splash
  screen hides, so there is no theme flash on startup).

### Changed
- **The design system is now theme-driven.** `src/theme` ships dark and light
  palettes, and every screen resolves colors through the settings store
  (`useTheme` / `useThemedStyles`) instead of a hardcoded dark palette.

## [1.6.1] — 2026-08-10

### Fixed
- **A stale session can no longer masquerade as "signed in".** When the
  backend rejects the session token even after a fresh-token retry (the
  signature of a session cached from the old development Clerk instance after
  the production migration), the app now signs out locally and returns to the
  sign-in screen instead of rendering a signed-in UI where every request
  silently fails. Fixes "ask a question and nothing happens" for any install
  carrying pre-migration credentials.

## [1.6.0] — 2026-08-10

### Added
- **Add any answer to your notes.** Settled assistant messages now have an
  "✎ Add to notes" action that opens a picker sheet: create a new note from
  the whole answer, or append it to any existing note (searchable list).
  Uses the new shared `POST /api/notes/append` route; the same feature ships
  on the web client in the same release (parity rule).

## [1.5.0] — 2026-08-10

### Changed
- **Moved to the Clerk production instance.** Sign-in previously ran through a
  Clerk *development* instance, so the Google consent screen asked users to
  continue to `helpful-jawfish-28.clerk.accounts.dev` — an unfamiliar hostname
  for a Bible study app, and capped at 100 users. It now reads **VerseMind**,
  backed by our own Google OAuth credentials.
- **This build is required.** Tokens issued by the old development instance are
  no longer accepted by the backend, so 1.4.x and earlier cannot sign in. Users
  keep all of their data: accounts are matched by verified email on first
  sign-in and re-attached to their existing conversations, notes and memories.
- Clerk's Frontend API is reached through a proxy on our own domain
  (`/__clerk`), which is what a production instance requires when the app is
  served from a `*.vercel.app` host.

### Added
- **Tap a verse reference, jump to the Bible.** References like "John 3:16"
  or "1 John 5:1–4" in chat messages (assistant and user alike) are now
  tappable amber links that open the Bible reader at that exact verse, with
  the same scroll-and-flash highlight as the Read chip. Ranges jump to the
  start verse; trailing translation tags ("John 3:16 KJV") are handled;
  anything unparseable stays plain text. Parity with the web client, whose
  verse popover now also has a "Read in the Bible" link.

## [1.4.1] — 2026-08-10

### Changed
- **Instant notes.** The notes library and editor now load from a persistent
  on-device cache (AsyncStorage) and revalidate silently in the background —
  the list and previously-opened notes render immediately with no spinner, and
  edits sync between the editor and the list with no pull-to-refresh.
  Revalidation also runs on tab focus and when the app returns to the
  foreground.

### Fixed
- **Faster notes API.** Read routes no longer write a User row on every
  request, the notes list endpoint serves a lightweight summary payload
  (bodies load per note), the single-note GET no longer ships the whole AI
  chat history, and note PATCH/DELETE are single database round-trips.
- Returning from the editor no longer flashes a refresh spinner over the list.

## [1.4.0] — 2026-08-10

### Added
- **Bible tab.** A new YouVersion-style tab between Chat and Notes: all 66
  books grouped by testament, a chapter-number grid per book, and a full
  chapter reading screen with adjustable type size (A−/A+, remembered for the
  session).
- **Offline KJV.** The complete King James text (31,102 verses) is bundled
  with the app and loads instantly without a network connection.
- **NKJV via network.** A KJV/NKJV toggle on the reading screen fetches NKJV
  chapters from bolls.life (15s timeout, per-session in-memory cache) with a
  friendly error + retry on failure.
- **Verse actions.** Long-press any verse for Copy, Share (Android share
  sheet), Save to note (same Scripture-blockquote note as chat verse cards),
  and Ask AI.
- **Ask AI hand-off.** A floating "✦ Ask AI" button asks about the current
  chapter, and the verse sheet can ask about a single verse; both push to the
  Chat tab with a prefilled, focused input (`?prompt=` — never auto-sent).

### Changed
- **Reading mode replaced.** The old `/reader` screen is gone; verse-card
  "Read" buttons now resolve the reference and open it inside the Bible tab
  (scrolling to and briefly highlighting the exact verse), with prev/next
  navigation that rolls into adjacent books.
- **Tab bar fix.** The custom glass tab bar now skips routes whose
  `options.href === null`, so hidden push-only screens no longer render a
  ghost tab.
- **Chat streaming.** `experimental_throttle: 50` on the AI SDK's `useChat`
  smooths token-by-token rendering during streams.

## [1.3.0] — 2026-08-10

### Added
- **Verse actions.** Every retrieved-verse card now has Copy, Share (Android
  share sheet), Save to note (creates a note titled by the reference with a
  Scripture blockquote, then opens it), and Read.
- **Reading mode.** New full-screen passage view (`/reader`) that fetches the
  exact KJV text via `/api/get-verse`, with adjustable type size (A−/A+),
  per-verse numbering, and copy/share of the whole passage. Reachable from
  verse cards; hidden from the tab bar.
- **EAS build pipeline.** `eas.json` with `development` (debug APK),
  `preview` (internal APK), and `production` (AAB, auto-increment) profiles.
- **OTA updates.** `expo-updates` wired with the `appVersion` runtime policy —
  JS-only fixes can ship via `eas update` instead of a fresh APK.
- **Test harness.** Vitest + `npm test` / `npm run typecheck` scripts. 41
  tests cover slash-command parsing, the chat view-model (tool outputs,
  follow-ups, DB history mapping), relative-date formatting, verse actions
  (share formatting, HTML escaping, create→patch note flow), and the API
  layer's retry/timeout/offline behavior.

### Changed
- **API resilience.** `apiJson` and `makeAuthedFetch` now retry once with a
  freshly-fetched Clerk token on 401 (an expired cached token used to surface
  as a user-facing failure), time out REST calls after 30s, and map network
  failures to a clear "you appear to be offline" error (`ApiError`).
- **Versions synced.** `package.json` and `app.json` both track the app
  version (1.3.0); `appVersionSource: local` in EAS keeps it that way.
- **Typed routes re-enabled** (`experiments.typedRoutes: true`); new
  navigation uses the object form (`router.push({ pathname, params })`).

### Notes for release
- Run `eas init` once to link the EAS project, then `eas update:configure`
  to stamp the updates URL into `app.json` (project id is intentionally not
  committed).
- `package-lock.json` needs a local `npm install` in `mobile/` to pick up the
  new dependencies (the lockfile is too large to commit via the API).
- Clerk publishable key is still the dev instance (`pk_test_…`); swap to the
  live key and configure the Play Store OAuth redirect before distribution.

## [1.2.0] — 2026-08-09

### Added
- **Slash commands.** Typing `/` in the chat input opens a glass command
  palette. AI commands are interpreted server-side by the model with its tools:
  `/note` (or `/add`) saves the last answer to notes, `/verse <ref>` quotes a
  passage word-for-word, `/search <topic>` searches the Scriptures,
  `/web <query>` searches the web, `/memory` recalls what VerseMind knows
  about you. Local commands run instantly: `/new`, `/clear` (with confirm),
  `/history`. The note AI panel gets `/suggest`, `/verse`, `/clear`.

### Tooling
- `scripts/push-phone.sh` + the `/push-phone` Claude skill: build and install
  straight to the S24 Ultra over wireless ADB, with port-rotation self-healing
  and a step-by-step recovery ladder when the phone is unreachable.

## [1.1.0] — 2026-08-09

### Changed
- **Sign-in rebuilt as the email-code flow** (enter email → 6-digit code).
  The Clerk instance only allows `email_code` + Google as first factors, so
  the password form could never succeed. Google SSO unchanged.

### Fixed
- Notes filter chips rendered as giant vertical pills (horizontal ScrollViews
  needed `flexGrow: 0`; the notes list needed `flex: 1`).
- (Server, paralleled) `addToNote` no longer creates a stray note when the
  model sends a blank `noteId`, and "this note" in the note chat always means
  the currently open note.

### Verified
- Full emulator pass: sign-in, streamed chat with verse cards, notes CRUD,
  and the AI writing John 3:16 into an open note with the editor updating live.

## [1.0.1] — 2026-08-09

### Fixed
- **Keyboard no longer covers the input fields.** Android 16's mandatory
  edge-to-edge ignores `adjustResize`; every KeyboardAvoidingView now uses
  `behavior="padding"`, and inputs drop the floating-tab-bar clearance while
  the keyboard is up so they sit flush against it. Applies to chat, sign-in,
  the note editor, and the note AI panel.

## [1.0.0] — 2026-08-09

Initial release — full native port of VerseMind (Expo SDK 57 / RN 0.86, arm64).

- **Chat**: streaming answers from GPT-5.6 Terra via the shared Vercel
  backend; retrieved-verse cards with match-strength badges; web-result cards;
  "Added to note" cards; follow-up chips; tool activity indicators
  ("Searching the Scriptures…"); conversation history with server persistence
  and restore; smart auto-scroll.
- **Notes**: folders, colored tags, search, pin, sort; Tiptap-compatible rich
  text editor (HTML round-trips with the web editor); per-note AI panel with
  history, Suggest Verses, and live note-append.
- **Auth**: Clerk native sign-in, session tokens in SecureStore, same account
  and data as the web app.
- **Design**: the web app's dark glassmorphism ported to native tokens —
  Pirata One wordmark, Cormorant Garamond Scripture blockquotes, amber
  accents, glass bottom tab bar. No stock Material UI.
