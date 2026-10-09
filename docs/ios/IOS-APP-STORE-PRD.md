# SureWord iOS: Capability Parity, Design Pass and App Store Launch (PRD)

Status: draft 1, 2026-10-07. Owner: Austin Spraggins.
Companion: `docs/ios/NEXT-SESSION-PROMPT.md` (the prompt that executes this).

## 1. Goal

Ship SureWord for iPhone and iPad to the App Store, with every user-visible
Android capability present and behaving the same, and a visual and interaction
quality that feels native to iOS 26 (Liquid Glass) and better than the Android
app. Android remains the source of truth (`CLAUDE.md` Parity Rule). Android's
Play Store release is in the same program of work (section 8) because several
store requirements are shared.

"Done" means every acceptance criterion in section 9 is green with evidence,
the build is in TestFlight and submitted for App Review, and
`docs/PARITY.md` has no iOS cell that is ❌, ⚠️ or an unqualified 🟡.

## 2. Current state (verified 2026-10-07)

- iOS target `SureWord-iOS` (`macos/`, SwiftUI, iOS 26, XcodeGen) builds clean
  on Xcode 27 for the iPhone 18 Pro simulator; 67 simulator tests pass.
  It shares `macos/Shared/` with macOS. Version 1.9.0 (10).
- Android is 1.79.0 (versionCode 88, Play internal + GitHub, 2026-10-07). iOS is roughly 70 minor versions behind.
- Commits 9457b35 and 5c400cc added `/check` and `/reply`, voice messages, My testimony and Share-into-SureWord. The Windows session wrote Apple source for the first three but never compiled it; it compiles on the Mac (iOS build succeeds 2026-10-07) but is unexercised. Apple has no share-into-SureWord at all. Android needed two `expo-share-intent` patches (empty cursor crash, `content://` read grants) after emulator proof; the iOS equivalent must be proven the same way.
- Signing: only an Apple Development certificate exists on this Mac. No
  Distribution certificate or provisioning profile. App Store Connect API keys
  are in `~/.appstoreconnect/private_keys` (provenance unknown). Whether the
  paid Apple Developer Program is active for team `389LLKGY3Y` is unconfirmed.
- No `PrivacyInfo.xcprivacy` for the app, no `aps-environment` entitlement, no
  App Store listing assets, no in-app account deletion on any client, no Sign
  in with Apple.
- Public `sureword.app/privacy` and `/terms` exist.

## 3. Principles

1. Same capability, same API calls, same behavior as Android. Layout adapts.
   Never remove a capability. The server is shared; prefer server changes.
2. Android is never regressed. Any shared-backend change is exercised against
   the Android contract and `pnpm test:logic`.
3. Nothing is "verified" without running it in the simulator (and on a device
   where listed). Static checks support proof, they never replace it.
4. Design is judged from screenshots a human can look at, not by tests.
5. Honest tracker: update `docs/PARITY.md` per change; never mark an
   unexercised path ✅.

## 4. Workstreams and requirements

Each requirement names its Android source of truth. The implementer must read
the Android code and `docs/FEATURES.md` for exact behavior; copy the contract,
not a paraphrase.

### A. Store blockers (cross-platform, do first)

| ID | Requirement | Notes |
|---|---|---|
| A1 | In-app **account deletion**: Settings → Account → Delete account, two-step confirm, calls a new `DELETE /api/account` that removes all user data (Prisma cascade audit across `User`, conversations, notes, testimony, voice-message transcripts and audio blobs, memories, highlights, learn, plans, church, shared answers, push tokens, feedback, blob attachments, Clerk user) and signs out. | Required by Apple 5.1.1(v) AND Google Play. Does not exist on any client today. Server work once, then Android, web, iOS, macOS clients. |
| A2 | **Sign in with Apple** (Clerk Apple provider) on iOS, plus equivalent on web/Android per Clerk support. | Apple 4.8 applies because Google SSO is offered. Needs Apple Services ID/key in Clerk. Verify Clerk's current native Apple flow in ClerkKit. |
| A3 | **Password sign-in** for password-bearing accounts on iOS (Android 1.19.1 behavior: Continue detects the password factor, code fallback). | The App Review and Play demo accounts are password accounts. |
| A4 | **AI disclosure and consent**: before first AI use, disclose that prompts, notes, personal testimony, voice recordings and context are sent to third-party AI providers (OpenAI incl. audio transcription, optionally the user's BYOK provider, Tavily, ElevenLabs) and obtain consent. Add a report/flag path for objectionable AI output (thumbs down already exists; confirm it reaches a human-reviewable queue). | Apple 5.1.2(i) and 1.2. Same copy on all clients. Decide with Austin if consent is a one-time sheet or part of onboarding. |
| A5 | `PrivacyInfo.xcprivacy` (collected types must include audio data, user content, and the testimony as sensitive personal/religious belief data) for the iOS app (and macOS) declaring collected data types, tracking = none, required-reason APIs actually used (UserDefaults, file timestamps, etc.). Audit every SPM dependency's manifest (Clerk, PhoneNumberKit). | Build must produce no privacy-manifest warnings. |
| A6 | `ITSAppUsesNonExemptEncryption = NO` (HTTPS only) in Info.plist; export compliance answers recorded. | |
| A7 | Privacy policy and terms on `sureword.app` updated for analytics, AI providers, account deletion, push, audio. Support URL page. | Policy must match the App Privacy answers exactly. |

### B. Auth and shell (iOS)

| ID | Requirement |
|---|---|
| B1 | Clerk email-code, Google SSO, Apple, password: all four work end to end on device. Deep link `sureword://sso-callback` allowlisted. |
| B2 | `x-sureword-client: ios` header on every API call (Android sets it once in `mobile/src/lib/api.ts`; mirror in the shared Swift networking layer; macOS sends `macos`). Server `platformFromHeaders` must accept both. |
| B3 | Client analytics parity (Android 1.72.1 to 1.73.0): screen views, app lifecycle, sign-in funnel (started/completed/failed by method, error code only), failed requests (route shape only), anonymous-trail-survives-to-account, internal/test traffic flag. Content rule from `docs/PARITY.md` "Usage analytics": no question, answer, note, highlight, church or verse text ever in a payload. Pin with a Swift test that mirrors `tests/analytics-event-mirror.test.mjs`. |
| B4 | Send feedback screen (Settings → Send feedback), same endpoint and rules as Android `settings/feedback.tsx`. |
| B5 | Settings hub parity (add **My testimony**, a private 2000-character box under About me in Settings → Memory, read by the assistant only when a question touches grace, salvation or doubt; the Apple README needs a note for it) with Android's nested pages (profile, Check for updates is Android-only and exempt, Appearance & reading, Highlight labels, My church, Memory + About me, AI, Shared answers, Notifications, About, Send feedback, Account incl. delete). |
| B6 | Notifications: local daily-verse reminder stays. If the paid program is active, enable APNs (`aps-environment`), register tokens through `POST /api/push-tokens`, and implement the "answer is ready" push and the morning verse-text push on the server for `platform: "ios"` (APNs key via Expo or direct; decide in the design gate). If not active, keep local-only and document it. |

### C. Reader and Bible (iOS)

| ID | Requirement | Android source |
|---|---|---|
| C1 | **Two-tier verse sheet**: non-modal peek (reference, two-line explanation teaser, pinned action bar: highlight dots + Ask / Copy / Share / Note / Learn), drag or tap up for study view with Explain / Words / See also tabs; multi-verse selection (contiguous, up to 10, cap message); all actions apply to the range; re-tap color removes. Selection rules mirror `verseSelection.ts` and are pinned by `tests/verse-selection.test.mjs`. | `mobile/src/features/bible/verse-sheet/` |
| C2 | Words tab (word study rows, lexicon expand, Ask about this word, Every verse) verified live in the simulator against production data. | `WordStudySection.tsx` |
| C3 | "See also" cross-references row. | `CrossReferencesSection.tsx` |
| C4 | **Parchment reader** (light/dark variants, follows the account `parchment` pref). | `ChapterReaderPane.swift` (macOS) is the reference; iOS has none. |
| C5 | **BSB** translation (all 66 books, speech spans, section headings, offline) plus KJV/NKJV; translation-aware search with alternate-translation fallback. | Android 1.60.0, 1.55.0 |
| C6 | Continue reading on the Bible home (resume last chapter; accept BSB entries). | `bible/index.tsx` |
| C7 | Reading plan card on Bible home and full **Reading Plans** screens (progress, streak, today, day list, presets, Build my own, mark done, archive, FROM YOUR PLAN tag). `Shared/Plan` model exists. | `mobile/src/features/plan/` |
| C8 | **Learn a verse**: add from reader/highlight, daily queue, masking ladder, scheduled reviews, offline review queue with revision-checked sync (`LearnSyncStore` contract), "Suggested for you". | `mobile/src/features/learn/` |
| C9 | Atlas (Timeline / People / Places): exercise every flow in the simulator, then upgrade 🟡 rows. | `mobile/src/features/atlas/` |
| C10 | Reading log screen verified (stats, sessions, partial ranges, offline queue). | |
| C11 | **Sermon studies** from your church: list, study view with quotes deep-linked to the video moment, KJV passages, reflection per section, artwork, dock (Watch the service, Ask AI); entry row hidden when the church has no channel. | `mobile/src/features/sermons/` |

### D. Chat (iOS)

| ID | Requirement |
|---|---|
| D1 | History search, rename, confirmed delete (Android 1.55.1). |
| D2 | Run-options picker parity (REASONING / SPEED / LENGTH / MODE, Models/Options tabs, summary label, search past 8 models) verified live. |
| D3 | Receipt line, copy answer, feedback chips sheet, share an answer + Show in search toggle: exercise each in the simulator against production as the reviewer account; fix whatever the 1.5.0-era code gets wrong. |
| D4 | Daily Cross: stay / fresh directions, and **on-demand Listen** per Android 1.78.0 (generation moved from the cron to an explicit user action) (narrator choice with voice preview, Calm / Natural / Expressive delivery, saved audio, speed, read-along, Pro lock panel). Background audio + Now Playing verified on a device. |
| D5 | Slash commands (now including `/check` and `/reply`), attachments (camera, library, files, paste), stop generating, answer recovery: smoke each. |
| D6 | **`/check` and `/reply`** (Android 1.79.0): weigh a claim, screenshot or voice message against Scripture; draft a short gentle reply. Exercise the shared Swift code against production and fix it. |
| D7 | **Voice messages**: attach or share an audio file (Files, Voice Memos, Messages, Discord); server transcribes once (free cap `AUDIO_TRANSCRIPTION_FREE_DAILY_MINUTES`, default 10 per rolling 24h, Pro uncapped); chip opens the transcript inline. Audio is an attachment type on iOS in addition to image/PDF/text. Contract: `docs/FEATURES.md` "Voice messages and sharing into SureWord". |
| D8 | **Share into SureWord**: an iOS Share Extension target (App Group hand-off to the app, text, URLs, images, PDFs, audio), opens a new chat pre-filled with the two actions "Check against Scripture" and "Help me reply"; the share survives sign-in (Android proved this signed-out). Prove with a real share from Files, Voice Memos and Safari, not only a synthetic intent. This was a stretch item in the first draft; it is now required. |

### E. Notes (iOS)

| ID | Requirement |
|---|---|
| E1 | Template picker (Verse study, Sermon, Prayer, Blank). |
| E2 | Editor chrome and menu parity: back, title with pin mark, AI, More (Pin, Tags, Note info, Copy as Markdown, Share as Markdown, Move to folder, Delete). Copy/Share Markdown via a Swift port of `noteMarkdownExport`, asserted equal by a shared-fixture test. |
| E3 | Wikilinks with insert picker, backlinks / outgoing links panel, aliases and custom properties (text/number/checkbox/list). |
| E4 | Close the three documented editor deferrals if feasible: toolbar undo/redo, hardware-Tab indent, Dynamic Type rescale. If any is not feasible, document why in `docs/PARITY.md`. |

### F. Billing

| ID | Requirement |
|---|---|
| F1 | **v1.0 launch decision (default): no purchase UI on iOS.** Free tier works; Pro-gated surfaces show the locked panel with no upgrade button and no link or mention of web purchase (Apple 3.1.1/3.1.3). Pro users (granted via web or `PRO_USER_IDS`) get Pro on iOS. |
| F2 | StoreKit 2 subscription (Pro $15/month) with server receipt/notification verification (App Store Server Notifications V2), entitlement merged into `resolvePlan`, restore purchases. Separate release after v1.0 is approved. Needs Austin's decision on price parity and on whether US link-out is acceptable. |

### G. Design pass: "gorgeous on iOS"

Principles: iOS 26 Liquid Glass used with restraint on chrome (tab bar, sheets,
floating controls, composer) and never behind long reading text; a gold-on-near-black
identity (`#0a0a0a`, gold, Pirata One / Cormorant Garamond already bundled);
content first.

| ID | Requirement |
|---|---|
| G1 | Design audit: screenshot every screen at iPhone 18 Pro, iPhone Air (smallest/most extreme), iPad Pro 13, in light, dark and parchment, at default and largest Dynamic Type. Produce a findings list ranked by impact. |
| G2 | Fix the findings: spacing and type scale, glass materials and morphing transitions for sheet tiers, matched-geometry transitions (book → chapter → reader), scroll edge effects, haptics on highlight/select/send/done, spring animations that respect Reduce Motion, SF Symbols with variable color where apt, refined empty and loading states (shimmer), consistent iconography. |
| G3 | **iPad**: a real layout, not a stretched phone. Sidebar/`NavigationSplitView` on regular width, reader + study side by side, multi-window not required. Support all orientations. |
| G4 | Reader typography: best-in-class reading (Cormorant for scripture, adjustable size/line spacing/margins, verse numbers, red-letter if sourced, speech spans), parchment texture performance (no frame drops while scrolling). |
| G5 | Accessibility: VoiceOver labels and traits on every control, Dynamic Type to AX5 without clipping, Reduce Transparency fallbacks for glass, contrast AA on gold-on-dark and parchment, Voice Control names, Increase Contrast, Reduce Motion. Run the Accessibility Inspector audit and record results. |
| G6 | App icon and launch: icon from the existing master through `scripts/apply-logo.py` (never hand-edit), tinted/dark icon variants for iOS 26, launch screen without a flash. |
| G7 | Widgets (Verse of the Day) are **stretch**, only if everything else is done; do not let them delay submission. (The share extension is now required: D8.) |

### H. App Store launch

| ID | Requirement |
|---|---|
| H1 | Confirm Apple Developer Program enrollment (Austin). Create App ID `com.spragginsdesigns.sureword` (matches macOS, enabling a universal purchase later), App Store Connect app record "SureWord", Distribution certificate and provisioning profile via the ASC API key. Switch iOS signing from "Sign to Run Locally"/Development to Distribution for archives only. |
| H2 | `bash macos/release-ios.sh` (new, modeled on `release-dmg.sh`): bump version/build, archive, export, upload to TestFlight with `xcrun altool`/`notarytool`-equivalent or Transporter CLI, attach the IPA as `SureWord.ipa` to the GitHub release per the fixed-asset-name invariant in `CLAUDE.md` only if the distribution method allows it (App Store IPAs are not publicly installable; follow whatever the invariant says and document the exception). |
| H3 | Listing: name, subtitle, promo text, description, keywords, categories (Reference, Lifestyle secondary), age rating questionnaire (AI chatbot, religious content, no UGC sharing beyond share links), support URL, marketing URL, privacy URL, copyright. All copy in `store-listing/app-store.md`, KJV mission voice, no unverifiable claims. |
| H4 | Screenshots: 6.9" iPhone and 13" iPad sets (5 to 8 each) generated from the real app in the simulator with a scripted capture (`macos/scripts/capture-screenshots.sh`), with captions. Optional app preview video. |
| H5 | App Privacy "nutrition label" answers matching A5/A7 exactly, recorded in `docs/ios/app-privacy.md`. |
| H6 | App Review notes: demo account credentials stored in 1Password (not in the repo), how to reach AI features, Pro behavior, church feature, and that content is KJV Scripture. Contact info. |
| H7 | TestFlight: internal group, then external beta with at least Austin's family/church testers; collect crash and feedback; fix blockers. |
| H8 | Submit for review; respond to rejections; release manually after approval. |

### I. Gaps added by the 2026-10-07 Android 1.50.0 to 1.79.0 audit

Source-level audit (grep of the Swift against the Android tree, not built or
run). Everything below is additive to sections A to H.

| ID | Requirement | Android source |
|---|---|---|
| B7 | **Offline cold start and per-account cache hygiene**: launching offline restores the signed-in identity from a cached Clerk resource; per-account Settings data (providers, church, memory count) is persisted, revalidated on focus and cleared on sign-out or account switch. | 1.54.0, 1.57.0/1.57.1; `settings/settingsData.ts`, `cacheOwner.ts` |
| B6a | Notification permission is never asked at launch; ask on the first settled answer or first Daily Cross visit. | 1.55.0/1.55.1; `notifications/permissionPrompt.ts` |
| D9 | **Photo downscale before upload**: picks over 2048px are resized and re-encoded as JPEG (iOS today only sets JPEG quality 0.9 in `ChatAttachmentSources.swift`). | 1.51.0; `chat/imageDownscale.ts` |
| G8 | iPad hardware-keyboard shortcuts and composer clearance (stretch). | 1.59.0; PARITY keyboard-shortcuts row |

Acceptance additions to existing IDs:

- **D1**: chat **rename** is missing on iOS (search and swipe-delete exist in `HistorySheet.swift`); a failed delete alerts and restores the history row (Android 1.76.0).
- **D3**: also exercise the "worked for" activity card restored from history (1.59.0, `WorkActivityView.swift`).
- **C9**: Atlas includes the Family and Trace screens (`atlas/family/[id]`, `atlas/trace/[id]`).
- **G2**: Cross opens nested in the Bible stack so Back returns to the devotional, then Bible home (1.50.0).
- **C4** is the parchment **reader surface** only: the `parchment` preference and Appearance toggle already exist on iOS.
- **B5** shrinks to: My testimony and About me are already in Settings; what remains is the nested hub (Android 1.69.0) versus iOS's single `List`, plus the README note.

Source present on iOS, so these lanes **verify and fix**, they do not rebuild:
B5 sections, D4 Stay/Fresh, D6 `/check` and `/reply`, D7 audio MIME types, C10
reading log, C9 Atlas modes, shared-answers Show in search, prayer status,
`PushRegistration.swift` (needs the `aps-environment` entitlement and server
wiring only). Confirmed absent: C3 cross-references, C8 Learn (chat quick
action is a "later phase" toast), C11 sermons, B2 header, A1.

Android-only by design (exempt): in-app updates and Check for updates, Google
Play billing, the notification small icon, Android back-stack and edge-to-edge
idioms, `expo-share-intent` patches (iOS uses D8), web-only guest answers.

## 5. Shared backend changes (summary)

- `DELETE /api/account` (A1) with a tested cascade and Blob cleanup.
- Clerk Apple provider configuration (A2); allowlist redirect URLs.
- Platform recognition for `ios`/`macos` in analytics and push (B2, B6).
- Optional APNs sender (B6), StoreKit server notifications (F2).
- Privacy/terms/support page copy (A7).

Every backend change auto-deploys on push to `main`; verify against production
after deploy per the repo workflow, and re-run `pnpm lint`, `pnpm test:logic`
and the relevant route tests.

## 6. Verification protocol (applies to every requirement)

1. Gate: `cd macos && xcodegen && xcodebuild -scheme SureWord-iOS -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -derivedDataPath build-<lane>.noindex test` green, plus macOS `-scheme SureWord` build green for any `Shared/` change (do not break macOS).
2. Run the feature in the simulator signed in as the reviewer demo account against production; capture screenshots into `docs/ios/evidence/<id>/`.
3. For anything involving audio, notifications, camera, haptics, sign-in with Apple/Google, StoreKit or APNs: a real iPhone run by Austin or on a connected device. These are release gates, not optional.
4. Compare behavior to Android for the same input (same prompt, same chapter) and note any difference.
5. Update `docs/PARITY.md` with evidence and the date. Update `docs/FEATURES.md` where a contract changed.

## 7. Delivery order and milestones

- **M0 Foundations (day 1):** audit Android 1.50 to 1.78 changelog against iOS and extend this PRD's gap table; A1 server half; B2; A5/A6; lane worktrees.
- **M1 Auth and store blockers:** A2, A3, A4, A1 clients, B1.
- **M2 Reader core:** C1 to C6, then D4.
- **M3 Breadth:** C7 to C11, D1 to D3, D5 to D8, E1 to E4, B3 to B5.
- **M4 Design pass:** G1 to G6 (can begin on finished screens during M2 and M3).
- **M5 Store prep:** A7, H1 to H6, TestFlight build.
- **M6 Beta and submit:** H7, H8. Then F2 and the stretch items.

Austin-only gates (cannot be done by an agent): confirm the Apple Developer
enrollment; approve App Store Connect agreements and tax/banking; approve the
AI consent copy; supply or approve the review demo account; run device tests;
press "Submit for Review".

## 8. Google Play (same program)

Android is already on Play internal testing. Public production is blocked by
Google's 12 testers for 14 days requirement (see `docs/PARITY.md`). Requirements
from this PRD that also gate Play: A1 account deletion (Play requires an
in-app path and a web deletion URL), A4 disclosures, A7 policy updates, and the
Data Safety form updated for analytics before promotion beyond internal. Track
these on the Android side as part of A1/A4/A7; promotion to production is a
deliberate act per `CLAUDE.md` (releases go to internal and closed testing only).

## 9. Acceptance criteria (100% definition)

1. Every row in sections 4A to 4H is implemented, or explicitly deferred by
   Austin in writing with the reason recorded here.
2. `docs/PARITY.md` shows no iOS ❌/⚠️ cells; 🟡 only where a device-only gate
   remains and is named.
3. iOS and macOS test suites green; web `pnpm lint` and `pnpm test:logic`
   green; Android `npm run typecheck && npm test` green if Android was touched.
4. Screenshots of every screen at the three device sizes in light, dark and
   parchment are in `docs/ios/evidence/`, reviewed, with no clipped text at
   AX5 and no layout overflow on iPhone Air or iPad.
5. Accessibility audit recorded with no unresolved critical issues.
6. TestFlight build installed on Austin's iPhone; the device-only gates in
   section 6.3 pass.
7. App Store Connect listing is complete and the build is submitted; any
   rejection is resolved or has a recorded plan.
8. macOS was not regressed (`bash macos/install-mac.sh` succeeds if `Shared/`
   changed).

## 10. Risks

| Risk | Mitigation |
|---|---|
| Paid program not active | Everything through M4 proceeds; M5/M6 wait on Austin. Ask first thing. |
| Apple rejects for 4.8, 5.1.1(v), 5.1.2(i), 3.1.1 | A1, A2, A4, F1 are in M1 and F1 deliberately has no purchase UI. |
| Shared Swift code changes break macOS | Build and test both schemes for every `Shared/` change. |
| Parallel lanes collide on `project.yml` / `Shared/` | Worktree per lane, one owner for `project.yml`, merge lanes serially, rebuild after every merge. |
| Weak-model code fails strict concurrency | Compile+test gate before review; two failures escalate the lane to a stronger model. |
| Liquid Glass hurts reading legibility | Glass on chrome only; Reduce Transparency fallback; review screenshots in parchment and dark. |
| Review team can't reach AI features | Demo account with a working Pro/Free path and written notes (H6). |
| Scope creep | Widgets are stretch (G7); StoreKit is post-1.0 (F2). |
