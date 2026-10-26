# Web, Android and iOS Parity: Remaining Work

- **Audit date:** 2026-10-26
- **Source baseline:** `origin/main` at `5581bd0c`
- **Requested scope:** web (`src/`), Android (`mobile/`), and iOS (`macos/SureWord-iOS/` plus shared Apple code)

This is the three-client inventory requested in the parity audit. **macOS is not audited or certified by this document.** `CLAUDE.md` also requires macOS parity, so shared Apple changes must still be built, installed, and exercised on macOS before the broader Apple/release parity gate is called complete. Where shared Apple source causes an iOS finding, macOS must be checked for the same behavior; macOS-specific remaining work needs its own reconciliation in `PARITY.md`.

This is the actionable counterpart to [`PARITY.md`](PARITY.md). The older file is a release ledger and mixes current status with historical evidence. This checklist separates:

- **Capability gaps:** behavior a client does not currently have.
- **Release and verification debt:** implementation exists, but the required real-path proof or store delivery is still open.
- **Deliberate differences:** approved platform behavior or a permitted superset, not an accidental defect.

The audit used current source, release tags, the parity/feature documents, and existing release receipts. It did not include a new device, simulator, browser, or build run. Do not turn a source finding into a verified fix without exercising the real client path.

## Completion rule

A row is done for this checklist only when the behavior is correct on web, Android, and iOS as applicable and the evidence is recorded in `docs/PARITY.md`. Android remains the primary acceptance client. Web follows on the deployed browser path. iOS needs the appropriate running-app proof, with a physical iPhone for StoreKit, push, and other device-dependent behavior. Compilation and unit tests alone never close an Apple runtime row. Shared Apple work also needs the macOS build/install/acceptance required by `CLAUDE.md` before the overall release can claim parity, even though macOS-specific work is outside this inventory.

## Priority order

1. Finish the two native purchase paths and the iOS App Review blocker.
2. Close notification behavior gaps and prove delivery and tap routing.
3. Implement the confirmed iOS composer, inline-reference, and note-picker gaps.
4. Close the web offline and direct file share-in gaps, then re-confirm the genuinely approved platform exceptions.
5. Clear the running-app verification backlog.
6. Clean up misleading copy, labels, and stale parity records.

---

## 1. Confirmed capability and behavior gaps

### 1.1 Native purchases and store access

- [ ] **Android: make Google Play Pro purchase available and prove the complete purchase lifecycle.**
  - Current state: native purchase/restore code exists, but production checkout remains disabled pending merchant/product configuration and a real store purchase. Web Stripe is the proven purchase path.
  - Remaining work: finish the Play merchant and `sureword_pro` setup, enable checkout only when the backend can verify it, then prove purchase, restore, renewal, cancellation, and account-deletion cancellation with test purchases.
  - Evidence: `mobile/src/features/settings/MembershipSection.tsx`, `src/lib/billing/google-play.ts`, `docs/PARITY.md` subscription rows.
  - Done when: a real Play test purchase becomes Pro, survives restore/reinstall, renews and cancels correctly, and the server remains authoritative.

- [ ] **iOS: record a successful physical-device sandbox purchase and resubmit for App Review.**
  - Current state: StoreKit 2 purchase, restore, transaction verification, and subscription management are implemented. Apple rejected the submission under 2.1(b) because it could not find the IAP in the reviewed binary and requested a physical-device recording. This is not a missing StoreKit implementation.
  - Remaining work: using the free review account, record from the Home Screen through sign-in and a successful sandbox SureWord Pro purchase. Ensure the subscription and group are submitted with the app version, then resubmit the prepared 1.26.0 build and complete any follow-up review requests.
  - Evidence: `macos/Shared/Billing/ProPurchaseStore.swift`, `macos/SureWord-iOS/Views/Settings/ProMembershipView.swift`, `docs/ios/review-notes.md`.
  - Done when: the physical purchase is recorded, the server verifies it as Pro, restore/manage work, and Apple accepts the submission or gives a new concrete blocker that is resolved.

### 1.2 Notifications

- [ ] **Web: suppress “Your answer is ready” after a deliberate Stop.**
  - Current state: Android records the stopped conversation and suppresses the subsequent notification. Web stops generation and cancels recovery but has no push-suppression counterpart, so a registered Web Push recipient can still be notified.
  - Evidence: `src/components/useChat.ts` (`abandonPendingAnswer`), `mobile/src/features/chat/useSureWordChat.ts`, `mobile/src/features/notifications/usePushNotifications.ts`.
  - Done when: Stop produces no answer-ready push for that conversation, an accidental disconnect still produces one, and a permitted notification tap opens the correct conversation.

- [ ] **Android: fix killed-state notification taps losing their destination.**
  - Current state: warm taps work, but a tap that cold-starts the app can open the default tab because the launching notification response never reaches JavaScript. This affects both the morning verse and answer-ready paths.
  - Evidence: `mobile/src/features/notifications/usePushNotifications.ts`, `docs/PARITY.md` notification rows.
  - Done when: cold and warm taps open the Daily Cross or the intended conversation exactly once on the supported Android release path, with no duplicate navigation.

- [ ] **iOS: enable remote morning-verse and answer-ready delivery.**
  - Current state: `PushRegistration.isServerDeliveryConfigured` is `false`, so registration stops before Expo-token exchange and server registration. The app has only the generic local daily reminder. The APNs entitlement exists; the old “missing entitlement” diagnosis is stale.
  - Remaining work: create/upload the SureWord APNs key to the EAS project, enable the client gate, and prove registration and delivery. Preserve the local fallback and stopped-answer suppression.
  - Evidence: `macos/SureWord-iOS/App/PushRegistration.swift`, `docs/ios/push-design.md`, `macos/project.yml`.
  - Done when: a physical device registers an Expo token, receives the personalized morning verse and answer-ready notifications, taps route correctly, local/remote reminders do not double-fire, and notification sound is acceptable on iOS without regressing Android.

### 1.3 iOS chat and reader behavior

- [ ] **iOS: add the SureWord AI composer chip.**
  - Current state: Android and web expose the current SureWord AI plan beside the composer, including the Pro premium mark. iOS has the picker in the Chat options menu but no corresponding composer affordance.
  - Evidence: `mobile/src/features/chat/ChatInputBar.tsx`, `macos/SureWord-iOS/Views/Chat/ChatInputBar.swift`, `macos/SureWord-iOS/Views/Chat/ChatTabView.swift`.
  - Done when: iOS shows the current plan and Pro mark, tapping opens the existing picker, switching plans updates the chip, and VoiceOver announces the same information.

- [ ] **iOS: make inline Bible references actionable in assistant and user messages.**
  - Current state: Android detects references and opens a matching retrieved passage in the Scripture sheet, falling back to the reader otherwise. iOS assistant Markdown has no verse-reference callback and user messages are plain text. The separate “Scripture in this answer” card works, but inline references open neither the sheet nor the reader.
  - Evidence: `mobile/src/features/chat/MarkdownBody.tsx`, `mobile/src/features/chat/MessageBubble.tsx`, `macos/SureWord-iOS/Views/Chat/MarkdownBody.swift`, `macos/SureWord-iOS/Views/Chat/MessageBubble.swift`.
  - Done when: supported references in both message roles open the matching passage sheet when available and the reader otherwise, ranges and ordinary URLs still work, and streaming does not regress reader performance.

- [ ] **iOS: let the reader’s Note action create or append to an existing note.**
  - Current state: Android opens `AddToNoteSheet` with `compose: false`. iOS always creates a new note titled with the reference and PATCHes its content; it never offers the existing-note picker from the reader.
  - Evidence: `mobile/app/(app)/bible/chapter.tsx`, `macos/Shared/Bible/VerseSheetModel.swift`, `macos/Shared/Chat/VerseActions.swift`.
  - Done when: the reader offers new-note and existing-note choices, appends through the shared contract without changing the selected Scripture, preserves the existing note, handles ranges, and leaves no empty orphan after a failed write.

- [ ] **iOS: route What’s New `sermons` and `timeline` targets directly.**
  - Current state: Android opens both destinations. Apple returns no direct target, so these cards offer Read more instead of Try it. The features themselves remain reachable through Study.
  - Evidence: `mobile/src/features/whatsNew/whatsNew.ts`, `macos/Shared/WhatsNew/WhatsNew.swift`.
  - Done when: Try it closes/presents the correct surrounding UI and opens the intended sermon studies or timeline destination without breaking Back behavior.

### 1.4 Web offline coverage

- [ ] **Web: guarantee offline KJV/BSB reading and search across the full corpus.**
  - Current state: Android bundles every KJV/BSB book. Web removed the complete Bible precache to avoid a roughly 28 MB first-visit download; books load on demand and only opened/cached books may work offline. Eviction or never opening a book means no guaranteed full-corpus offline access. The parity rule makes this an outstanding capability gap, not a completed design choice.
  - Recommended direction: use an explicit, versioned “Download offline Bible” flow with progress, failure recovery, storage-pressure handling, and a clear ready state rather than silently restoring a large mandatory precache.
  - Evidence: `next.config.mjs`, `src/lib/bible/bsb.ts`, `mobile/src/features/bible/bsb.ts`, `docs/FEATURES.md` Bible-reader section.
  - Done when: all 66 books can be read and searched after an offline cold restart without depending on which pages were previously opened, and updates/eviction cannot silently remove the guaranteed offline corpus.

### 1.5 Smaller correctness and copy gaps

- [ ] **Web: accept image, PDF, audio, and supported text files through the installed PWA share target.** The current GET target accepts only title/text/URL; picker, drag/drop, and paste do not provide the same direct share-in capability as Android. Implement the file-capable share contract with authentication return, per-type and per-message limits, and the existing Verify/Check/Help actions. Done when supported files arrive intact, oversize shares fail without partial residue, and the flow works after a cold start and sign-in. Evidence: `public/site.webmanifest`, `src/app/share/page.tsx`, `mobile/app.json`.
- [ ] **Android and iOS: add the `organizeNote` activity label.** Mirror web’s “Filing your note” instead of falling back to the generic working label. Evidence: `src/lib/tool-activity-labels.ts`, `mobile/src/lib/chatView.ts`, `macos/Shared/Chat/ChatViewMessage.swift`.
- [ ] **Web: remove the obsolete personal-provider-key FAQ answer.** Included AI is now Free or Pro; users are no longer told to add a key. Evidence: `src/lib/marketing/faq.ts`.
- [ ] **Web: update support for current authentication.** Password-based sign-up now exists, so “There is no separate SureWord password to create” is no longer accurate. Evidence: `src/lib/marketing/legal-content.ts`.
- [ ] **Web: update support for subscription deletion.** Android’s current account-deletion path cancels Google Play renewal before deletion and warns separately when an App Store subscription needs user cancellation; the older support text still tells every Play subscriber to cancel manually. Evidence: `mobile/CHANGELOG.md` 1.99.1, `src/lib/account-deletion.ts`, `src/lib/marketing/legal-content.ts`.

---

## 2. Release and runtime verification backlog

These rows are not assertions that a feature is absent. They are the proof still required before calling the corresponding parity row verified. Use disposable accounts and non-destructive test data. Never delete a real user account or purchase with a real payment method for QA.

### 2.1 Shared acceptance

- [ ] **Account deletion:** exercise a real disposable account on web, Android, and iOS, including success, retry/failure behavior, cache/sign-out cleanup, and the applicable Stripe, Play, or App Store subscription warning/cancellation path.
- [ ] **Current SureWord AI plans:** verify Free, Pro, and owner-plan presentation and request behavior after BYOK removal. Confirm there are no add-key controls, no stale reasoning options, the Pro mark is correct, and included usage remains server-enforced.
- [ ] **Native usage enforcement:** exercise Free exhaustion, Pro limits, utility/background work, and recovery on Android and iOS rather than relying only on shared API tests.
- [ ] **Authentication:** complete real provider round trips where still open: Google on Android and iOS, Apple on iOS, and the password-bearing review/demo account on iOS. Confirm unknown-email sign-up and existing-email sign-in crossover remains intact.

### 2.2 Android proof

- [ ] **Personal share reflections:** complete an authenticated share draft, preview, publish, and revoke flow on the signed release build.
- [ ] **Other calendar:** download/share the authenticated `.ics` on a signed-in physical device and verify an uncertain event retains its warning and church-app link.
- [ ] **Translation-aware reader search:** exercise selected-translation search, alternate-translation fallback, retry, and opening a result in the matching translation on a device.
- [ ] **Push-token ownership and share-size caps:** verify device proof on a physical device and verify an oversized shared file is capped/rejected without partial data or cache residue.
- [ ] **Quiz 1.100.1 follow-up:** rerun the signed Android path after the scroll fix; answering must keep the question visible while the verse card appears. The earlier release shipped after the emulator lost sign-in.
- [ ] **Physical notification taps:** independently cover warm and cold Daily Cross and conversation taps; use this to close the known cold-start defect, not merely to confirm warm behavior.
- [ ] **Study Bible notes loop:** on a released Android build, verify inline note indicators, the Notes tab, excerpts, and create/append behavior. The source is already in tagged releases starting with `android-v1.90.0`; this is proof debt, not an undelivered-source item.
- [ ] **Alive and LC Greek:** on released Android builds, exercise edition choice/recommendation, continuation and fallback, LC Greek display, and verse actions for Matthew, Mark, Luke, and John. The source is already in tagged releases: Mark from `android-v1.88.0`, the initial LC Greek plus Matthew/Luke updates from `android-v1.88.1`, and John from `android-v1.89.1`.

### 2.3 Web proof

- [ ] **Real Web Push:** prove subscription registration, daily-verse delivery, answer-ready delivery, service-worker display, and tap routing in a supported browser. Add deliberate-Stop coverage when that fix lands.
- [ ] **Authenticated splash:** verify the signed-in cold-start splash, skip behavior, reduced motion, and no replay on an ordinary tab switch in a real browser; existing evidence is layout/build proof.
- [ ] **Learn interactive flow:** complete add, all practice modes, grading, queue progression, and offline review synchronization in the browser. Production/API verification alone does not close the interactive row.
- [ ] **Offline implementation:** after the offline work in section 1.4, test a fresh profile, a returning profile, expired/versioned content, storage eviction pressure, and offline cold restart.

### 2.4 iOS proof

Ordinary UI behavior may be proved in the simulator where that is the project’s accepted path. StoreKit, APNs/push, share extensions with device-only behavior, and final TestFlight acceptance need a physical iPhone.

- [ ] **Current TestFlight build:** run the prepared 1.26.0 build on a physical iPhone and cover the new SureWord AI picker/no-BYOK UI, Quiz, and a complete signed-in Walk with me run after the final rebase. TestFlight upload alone is not App Review submission or device proof.
- [ ] **What’s New and Connections:** exercise catch-up presentation/seen persistence, release search/filter/detail, Try it or Read more, Connections filtering, streamed explanation, and Chat/reader handoffs in a running app.
- [ ] **Reading Plans:** complete preset and custom-plan creation, reader-driven progress, manual Mark done, archive/replace, streaks, and reopening in a signed-in workflow. The screen and shared model already exist.
- [ ] **Atlas:** exercise Timeline, People, Places, search, journeys, relationships, trace steps, and chapter/reader handoffs in the native flow.
- [ ] **Study Bible notes loop and Alive/LC Greek:** exercise the Notes tab/indicators plus the append-picker fix when it lands; verify all four Alive books, edition carry/fallback, LC Greek display, and verse actions.
- [ ] **Listen and reading history:** verify spoken-devotional Pro lock, playback speed, background playback/Control Center, and the reading log, map, stats, and reflection.
- [ ] **Reader study:** verify AI consent presentation and persistence, parchment, Continue reading, Words/Strong’s study, Learn grading and queue advancement, and Learn chat receipts.
- [ ] **Personalization and church:** verify synced preferences, About me, testimony, highlight labels, My church search/save/remove, sermon studies, church events, prayer states/receipts, and Daily Cross direction controls.
- [ ] **Chat and sharing:** verify stream recovery, saved status/work history, slash commands, voice attachments/transcripts, answer feedback/copy/edit/retry/share, shared-answer list/revoke, personal reflections, Share cards, and Send a word.
- [ ] **Notes and share-in:** verify note list/create/edit/delete behavior, rich-text formatting and export, wikilinks/backlinks/properties, Share Extension input, and the shared-file byte cap with no partial residue.
- [ ] **Telemetry and feedback:** prove real iOS PostHog arrival, `x-sureword-client: ios`, and a signed-in Send feedback message rather than relying only on synthetic events or source tests.

---

## 3. Deliberate differences to retain or consciously revisit

These are not accidental implementation gaps. Do not silently convert them into defects; changing them needs a product decision and an updated parity contract.

- **YouTube `/verify` on web:** ordinary links work through `readLink`, and pasted transcripts work, but a bare YouTube link cannot fetch captions in the browser and the server is blocked by YouTube. Android/native clients fetch on-device. This was explicitly approved on 2026-10-07. Evidence: `docs/FEATURES.md`, `src/lib/ai-tools.ts`.
- **Atlas offline scope:** Android intentionally bundles Timeline/People/Places data for offline use. Web and iOS use the API for the same online atlas. If full offline atlas is required elsewhere, specify a separate versioned offline-data contract rather than assuming it exists. Evidence: `mobile/src/features/atlas/atlas.ts`, `src/components/atlas/useAtlas.ts`, `docs/PARITY.md`.
- **Permitted web supersets:** guest “Try before you sign up,” browser keyboard shortcuts, the Android APK install link, and other web-only landing/editor affordances are allowed. They are not Android or iOS defects.
- **Platform-native behavior:** sheets versus sidebar/navigation, App Store versus Play billing, Apple Calendar versus another-calendar handoff, and store-specific update rows are valid form-factor/platform adaptations when the underlying capability remains available.
- **Roadmap items absent from every client:** features planned for a later cross-client release are not parity regressions. Do not list them here until at least one supported client ships them.

---

## 4. Stale records: do not reopen these as missing features

The following should not be used as evidence of current capability gaps. Update older rows when their related feature is next touched, but keep this checklist focused on real remaining work.

- **Reading Plans:** native iOS UI and the shared plan model exist; remaining work is the full workflow proof in section 2.4.
- **iOS StoreKit:** implemented for iPhone/iPad. The open item here is physical purchase/App Review proof, not building the iOS StoreKit flow from scratch. This says nothing about macOS purchase capability, which is outside this inventory and must be assessed separately.
- **iOS editor deferrals:** toolbar undo/redo, hardware-Tab list indentation, and live Dynamic Type rescaling are documented as completed in `macos/README.md`.
- **Support page:** `https://sureword.app/support` exists and is publicly reachable. Its outdated auth/subscription copy is separately listed in section 1.5.
- **Web notifications infrastructure:** registration, server fan-out, service-worker display, and tap handlers exist. The current gaps are deliberate-Stop suppression and real delivery proof, not a total absence of Web Push code.
- **Auth welcome and BYOK removal:** current `origin/main` contains the separate Create account/Sign in flow and removes personal-provider-key UI across the clients. Older “separate buttons pending” and “BYOK removal pending” cells are historical.
- **Android Study Bible notes loop:** already present in tagged Android source releases from `android-v1.90.0`; do not repeat the old “ships in the next Android build” claim.
- **Android Alive/LC Greek:** already present in tagged Android source releases from `android-v1.88.0` onward, with John from `android-v1.89.1`; do not repeat the old “next build” claim.
- **Older Apple environment blockers:** superseded Xcode-license/CoreSimulator statements and old iOS sermon-studies “not built” cells are not current capability evidence. Record the actual current build/test blocker instead.
- **iOS APNs entitlement:** present for Debug and Release in `macos/project.yml`. Remote push is blocked by credentials, the source gate, and delivery proof.
- **iOS inline-reference ✅ row:** contradictory to current source and must not be used to close section 1.3’s inline-reference gap.
- **Planned-feature notes:** Quiz me and Walk with me now have implementations on web, Android, and iOS; older planned-only labels are stale. The old Pro/BYOK product-design note also predates the no-BYOK decision.

---

## 5. Evidence and update protocol

Primary records:

- [`PARITY.md`](PARITY.md): release ledger and detailed per-feature evidence.
- [`FEATURES.md`](FEATURES.md): cross-client feature contracts and architecture.
- [`../mobile/CHANGELOG.md`](../mobile/CHANGELOG.md): Android release notes and shipped version history.
- [`../macos/README.md`](../macos/README.md): Apple implementation and build status.
- [`ios/review-notes.md`](ios/review-notes.md): current App Review requirements.
- [`ios/push-design.md`](ios/push-design.md): iOS remote-push enablement design.

When a row ships:

1. Exercise the real Android path first, then deployed web, then the appropriate iOS running-app/device path. For shared Apple work, also complete the macOS build/install/acceptance required by `CLAUDE.md` before making a broader release-parity claim.
2. Record versions, build numbers, test account type, and exact proof limits. Never convert a compile or unit-test result into a device/runtime claim.
3. Update the relevant `PARITY.md` row and this checklist in the same change.
4. Move intentional exceptions into section 3 with the decision and rationale rather than marking them full parity.
5. Remove only the completed row; keep unrelated verification debt visible.
