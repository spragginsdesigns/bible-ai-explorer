# Web, Android and iOS Parity: Remaining Work

- **Audit date:** 2026-10-26
- **Source baseline:** `origin/main` at `5581bd0c`
- **Requested scope:** web (`src/`), Android (`mobile/`), and iOS (`macos/SureWord-iOS/` plus shared Apple code)

This began as the three-client inventory requested in the parity audit. The dated 2026-10-28 reconciliation also includes reviewed macOS source, but **does not certify macOS runtime or release parity**. `CLAUDE.md` requires shared Apple changes to be built, installed and exercised on macOS before the broader Apple/release gate closes. Mac-specific evidence and remaining work are recorded in `PARITY.md`.

This is the actionable counterpart to [`PARITY.md`](PARITY.md). The older file is a release ledger and mixes current status with historical evidence. This checklist separates:

- **Capability gaps:** behavior a client does not currently have.
- **Release and verification debt:** implementation exists, but the required real-path proof or store delivery is still open.
- **Deliberate differences:** approved platform behavior or a permitted superset, not an accidental defect.

The audit used current source, release tags, the parity/feature documents, and existing release receipts. It did not include a new device, simulator, browser, or build run. Do not turn a source finding into a verified fix without exercising the real client path.

## 2026-10-28 Apple reconciliation

Reconciled through **23:29 UTC**. The six Apple lanes and upstream ASV/creator
histories are retained; the 112-entry worktree audit found no omitted source.
Mac metadata is **1.30.0 (39)**, with native `1643de78` used by uploaded iOS
**1.30.0 (2)**. Android source is **1.110.0 (129)**; its separate editor work is outside
this task. Apple catch-up remains **128**. Source, unit/build proof, runtime
acceptance and distribution remain separate gates; full parity is not certified.

The approved offline Atlas implementation runs all seven canonical queries
locally through serialized JavaScriptCore, without online fallback. Resource/hash
checks, 28 Node tests/31 golden cases and seven signed native cases pass. Three
public-harness iOS Atlas UI cases pass for relationships/journeys/trace and
Places/Timeline reader navigation. Mac long-scroll acceptance reached People →
Zipporah, the final Patmos event and Revelation 22:20 in the reader, with the same
process and no new crash report. That installed build contains temporary
diagnostics and an inline-credit trial since reverted on disk; final clean Mac
recheck and real offline cold-start proof remain open. See
`mac-atlas-final-runtime-baseline.json`.

The current `sureword.app` alias is READY at docs-only `002370b6`, with backend
code identical to `b2b40b5e`. The earlier both-alias/cancellation-enabled/300-second
receipts remain historical; the current alias is not `b2b40b5e`. Both additive notification migrations have verified
checksums and no data-count change. Gates pass: **1,891 total, 1,874 passed,
17 skipped, zero failed**, typecheck/lint exit 0 and a 234-page build exit 0.
Session-bound closed-app answer delivery and a bounded deliberate-Stop run have
production receipts. Actual SDK sign-out clears local remote identity while
retaining token/proof and the old server row. The assistant persisted after
sign-out at **23:11:57.906 UTC**, but `disconnected=false` prevented recipient
selection: no audience/guard/APNs metrics means that attempt did not exercise the
guard. Zero exact-target OS records through **23:14:16 UTC** does not prove it.
The repeat SDK sign-out plus quit/forced-disconnect case awaits restoration of
the existing Google session. Manual taps, migration/failure and physical iOS
delivery remain open.

Signed SW-C1 units report **Passed: 962 total, 961 passed, one skipped, zero
failed**: 581 XCTest executions including the skip, plus 381 Swift Testing
tests across 44 suites. New coverage includes seven Atlas, eight account-delivery,
five Stop and one APNs-fence cases. No broad running-app/device/store checkbox
is closed by these counts.

**Mac Chat-transition layout still fails acceptance.** Temporary layout/auth
tracing has been removed from product source with its patch/logs retained. The
installed diagnostic build still awaits a real Google sign-in; it is not the
final shipping artifact. Final clean build/runtime acceptance,
new notarization/stapling/Gatekeeper and publication remain open; the old
`d30c9937` DMG is stale. iOS release session **80571** exited **0**, uploading
**1.30.0 (2)** at **23:13:47 UTC**; ASC readback at **23:20:01 UTC** confirms
**VALID**, not expired (`ios-130-build2-asc-readback.json`). A further read at **23:24:06 UTC** confirms internal
`READY_FOR_BETA_TESTING` and external `READY_FOR_BETA_SUBMISSION`. Physical-device
acceptance and beta review remain open. The earlier build-1 archive and all work-directory records
were preserved by atomic rename at **23:09:28 UTC** to
`/tmp/sureword-parity-takeover/ios-130-build1-preserved.noindex`;
`ios-build1-preservation.json` records it. Earlier **1.30.0 (1)
VALID/internal-ready** remains valid for its older cohort. Public Mac **1.28.0**
and Store **1.26.0 READY_FOR_SALE** remain unchanged. Preserve the latest published
Android 1.110.0 fixed-name APK bytes when publishing Mac.

The dedicated review account's saved password was rejected on actual web and
iOS login. Read-only Production Clerk readback confirms the documented account,
password sign-in enabled, no lock/ban and MFA off. Its password-change timestamp
is **2026-10-08 00:18:41 UTC**, while the 1Password note says October 26; this does
not identify the active password. A user-only password-dialog handoff is pending,
with no credential mutation or successful authenticated acceptance claimed.
Receipt: `sureword-review-clerk-dashboard-readback.json`, checked **23:02:37 UTC**.

Earlier Mac notes/title, file/URL-share, ASV, Connections and inline-reference
proofs remain in `PARITY.md`. The earlier three narration/initial-ASV UI cases
passed; the public harness does not prove authenticated iOS picker writes.
Physical iPhone 13 remains unavailable. StoreKit/device APNs, provider login,
iOS migration/sign-out, manual OS taps, new TestFlight/external beta acceptance,
App Store approval and Mac publication stay open. See `PARITY.md` for exact
cohort receipts; the earlier AX-read replay is not closed-app proof.

## Completion rule

A row is done for this checklist only when the behavior is correct on web, Android, and iOS as applicable and the evidence is recorded in `docs/PARITY.md`. Android remains the primary acceptance client. Web follows on the deployed browser path. iOS needs the appropriate running-app proof, with a physical iPhone for StoreKit, push, and other device-dependent behavior. Compilation and unit tests alone never close an Apple runtime row. Shared Apple work also needs the macOS build/install/acceptance required by `CLAUDE.md` before the overall release can claim parity, even though macOS-specific work is outside this inventory.

## Priority order

1. Finish the Android purchase lifecycle and the newest Apple release/device acceptance; the old iOS rejection is superseded by 1.26.0 READY_FOR_SALE.
2. Close notification behavior gaps and prove delivery and tap routing.
3. Prove the implemented Apple composer, inline-reference, note-picker and navigation paths on the final signed build.
4. Close the web offline and direct file share-in gaps, then re-confirm the genuinely approved platform exceptions.
5. Clear the running-app verification backlog.
6. Clean up misleading copy, labels, and stale parity records.

---

## 1. Confirmed capability and behavior gaps

### 1.1 Native purchases and store access

- [ ] **Android: make Google Play Pro purchase available and prove the complete purchase lifecycle.**
  - Current state, checked live 2026-10-28: production `/api/billing/status` reports `enabled=true`, `playCheckoutAvailable=false`, and `appStoreCheckoutAvailable=true`. Google initially returned 404 for `sureword_pro`. Created that product with the implemented Pro benefits and saved its `monthly` auto-renewing base plan as `DRAFT`: US only, exactly USD 15.00/month, Google's default 7-day grace period and automatic account hold. Read-back through the Publisher API returned 200 and the same draft configuration. No base plan activation, checkout flag change, or purchase occurred. Creation succeeded, but merchant payout readiness was not independently verified. Web Stripe remains the previously proven purchase path.
  - Remaining work: verify merchant/payout readiness and backend purchase-verification credentials, activate the prepared base plan for a controlled license-test run, then prove purchase, restore, renewal, cancellation, and account-deletion cancellation before leaving checkout enabled. Expand regional availability only after choosing the intended launch markets.
  - Follow-up: [SureWord: prove Google Play Pro purchase lifecycle and enable checkout](https://ticktick.com/webapp/#p/6a6cf86e8f08eca156943243/tasks/6ae2157e8f089b81ed18c7e0).
  - Evidence: `mobile/src/features/settings/MembershipSection.tsx`, `src/lib/billing/google-play.ts`, `docs/PARITY.md` subscription rows.
  - Done when: a real Play test purchase becomes Pro, survives restore/reinstall, renews and cancels correctly, and the server remains authoritative.

- [ ] **iOS: verify the current release's physical-device purchase lifecycle and submit the newest Apple build.**
  - Current state: StoreKit 2 purchase, restore, transaction verification and subscription management are implemented. App Store Connect returned iOS 1.26.0 `READY_FOR_SALE` on 2026-10-28. The older 2.1(b) rejection and recording request are historical and must not be presented as an active rejection.
  - Remaining work: exercise sandbox purchase/restore/manage and authoritative Pro verification on a physical iPhone for the final 1.30.0 source. Prepare any recording/review evidence needed for that new submission, attach the correct subscription/group, upload/read back the newest TestFlight build, and complete the new review cycle.
  - Evidence: `macos/Shared/Billing/ProPurchaseStore.swift`, `macos/SureWord-iOS/Views/Settings/ProMembershipView.swift`, dated `PARITY.md` checkpoint. Older `docs/ios/review-notes.md` requirements need checking against the new submission.
  - Done when: the latest physical purchase lifecycle and required review evidence are recorded and that exact release is accepted; 1.26.0's existing sale state does not prove 1.30.0.

### 1.2 Notifications

- [ ] **Web: suppress “Your answer is ready” after a deliberate Stop.**
  - Current state: Android records the stopped conversation and suppresses the subsequent notification. Web stops generation and cancels recovery but has no push-suppression counterpart, so a registered Web Push recipient can still be notified.
  - Evidence: `src/components/useChat.ts` (`abandonPendingAnswer`), `mobile/src/features/chat/useSureWordChat.ts`, `mobile/src/features/notifications/usePushNotifications.ts`.
  - Done when: Stop produces no answer-ready push for that conversation, an accidental disconnect still produces one, and a permitted notification tap opens the correct conversation.

- [ ] **Android: fix killed-state notification taps losing their destination.**
  - Current state: warm taps work, but a tap that cold-starts the app can open the default tab because the launching notification response never reaches JavaScript. This affects both the morning verse and answer-ready paths.
  - Evidence: `mobile/src/features/notifications/usePushNotifications.ts`, `docs/PARITY.md` notification rows.
  - Done when: cold and warm taps open the Daily Cross or the intended conversation exactly once on the supported Android release path, with no duplicate navigation.

- [ ] **Both Apple apps: prove direct-APNs morning-verse and answer-ready delivery.**
  - Current source: both clients register raw hex tokens plus an APNs environment. The server stores `apns:<environment>:<hex>`, routes directly to Apple, and retains legacy iOS Expo rows. The former `isServerDeliveryConfigured = false`/Expo-upload plan is superseded. iOS reads signed build metadata; macOS reads its actual APS entitlement.
  - Configuration: separate SureWord-only Sandbox/Production keys, six Production-scope Vercel secrets, and the active installed `MAC_APP_DIRECT` production profile are prepared. Configuration is not a deployed sender or delivery receipt.
  - Current runtime: `sureword.app` is READY at docs-only `002370b6` with the same backend code as `b2b40b5e`. Earlier `b2b40b5e` receipts prove closed-app delivery and a separate durable-Stop completion with no push work or exact-target OS record during the bounded observation. Actual SDK sign-out cleared local identity while retaining token/proof and the old server row, but its post-sign-out completion had `disconnected=false` and no recipient/guard/APNs work. Zero OS records is bounded absence; the guard was not exercised.
  - Remaining work: repeat SDK sign-out with quit/forced disconnect after restoring the existing Google session, then finish migration/sign-out failure sequences and delayed-notice cleanup; verify both personalized notifications, cold/warm taps and local/remote dedup on final clean signed builds. Mac layout acceptance and fresh notarization remain open. No physical iOS delivery or universal Stop absence guarantee is claimed.
  - Evidence: `macos/SureWord-iOS/App/PushRegistration.swift`, `macos/SureWord/App/MacPushRegistration.swift`, `macos/Shared/App/APNsRegistration.swift`, `src/lib/apns.ts`, `docs/ios/push-design.md`.
  - Done when: the final signed Apple builds receive and route both notifications without duplicate or previous-account banners, including the Mac with the app closed and a physical iPhone. Android/legacy Expo behavior must remain intact.

### 1.3 iOS chat and reader implementation: remaining acceptance

- [ ] **iOS: prove the implemented SureWord AI composer chip.**
  - Current source, 2026-10-28: iOS `ChatInputBar` now renders the current SureWord AI composer chip, premium mark and accessible picker action. Keep this row open for the final signed running-app proof; it is no longer a missing implementation.
  - Evidence: `mobile/src/features/chat/ChatInputBar.tsx`, `macos/SureWord-iOS/Views/Chat/ChatInputBar.swift`, `macos/SureWord-iOS/Views/Chat/ChatTabView.swift`.
  - Done when: iOS shows the current plan and Pro mark, tapping opens the existing picker, switching plans updates the chip, and VoiceOver announces the same information.

- [ ] **iOS: verify actionable inline Bible references in assistant and user messages.**
  - Current source, 2026-10-28: both Apple chat shells use shared `VerseLinks` routing for assistant/user references, retrieved-passage matching and reader fallback, including localized book parsing. A bounded Mac user-reference handoff was exercised; assistant passage-sheet, ranges, ordinary URLs and final iOS behavior still need acceptance.
  - Evidence: `mobile/src/features/chat/MarkdownBody.tsx`, `mobile/src/features/chat/MessageBubble.tsx`, `macos/SureWord-iOS/Views/Chat/MarkdownBody.swift`, `macos/SureWord-iOS/Views/Chat/MessageBubble.swift`.
  - Done when: supported references in both message roles open the matching passage sheet when available and the reader otherwise, ranges and ordinary URLs still work, and streaming does not regress reader performance.

- [ ] **iOS: prove the reader’s new/existing-note picker and persistence.**
  - Current source, 2026-10-28: both readers open the generalized `AddToNoteSheet` with `compose: false` through `POST /api/notes/append`, offering new/existing notes and an Open note handoff. A bounded Mac new-note handoff was exercised. The canonical untouched-note/AI-reload baseline and single title/body writer are corrected, with focused regressions passing; earlier Mac existing-note preservation and immediate-departure title/body persistence were exercised. Final iOS range/picker/failure acceptance remains open.
  - Evidence: `mobile/app/(app)/bible/chapter.tsx`, `macos/Shared/Bible/VerseSheetModel.swift`, `macos/Shared/Chat/VerseActions.swift`.
  - Done when: the reader offers new-note and existing-note choices, appends through the shared contract without changing the selected Scripture, preserves the existing note, handles ranges, and leaves no empty orphan after a failed write.

- [ ] **iOS: verify What’s New `sermons` and `timeline` direct routes.**
  - Current source, 2026-10-28: `WhatsNewRules` maps sermons/timeline to native Study destinations, with pending-destination consumers on both Apple shells. Final Try it/back/seen-persistence acceptance and catch-up-version reconciliation remain open.
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
- [ ] **Android: add the `organizeNote` activity label.** Mirror web’s “Filing your note” instead of falling back to the generic working label. The Apple source gap is closed: `macos/Shared/Chat/ChatViewMessage.swift` already has that exact label. Android acceptance is unchanged. Evidence: `src/lib/tool-activity-labels.ts`, `mobile/src/lib/chatView.ts`.
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
- [ ] **Authentication:** complete real provider round trips where still open: Google on Android and iOS, Apple on iOS, and the dedicated review account on iOS. Its saved password was rejected on web and actual iOS; the Production dashboard shows no lock/ban or MFA and an October 8 UTC password-change timestamp versus an October 26 vault note. The user-only password-dialog handoff is pending; do not retry or reset on the user’s behalf. Confirm unknown-email sign-up and existing-email sign-in crossover remains intact.

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

- [ ] **Current TestFlight build:** release session 80571 exited 0 and uploaded 1.30.0 (2) at 23:13:47 UTC; ASC readback at 23:20:01 UTC confirms VALID and not expired. A 23:24:06 UTC read confirms internal READY_FOR_BETA_TESTING and external READY_FOR_BETA_SUBMISSION; beta review remains open. Build 1 and its full work directory are preserved, but that earlier cohort does not cover this source. Exercise the new build on a physical iPhone, including composer, Quiz, Walk with me, sharing, Atlas and APNs. Existing iOS 1.26.0 is READY_FOR_SALE; neither that state nor upload/processing substitutes for latest-build device proof.
- [ ] **What’s New and Connections:** exercise catch-up presentation/seen persistence, release search/filter/detail, Try it or Read more, Connections filtering, streamed explanation, and Chat/reader handoffs in a running app.
- [ ] **Reading Plans:** complete preset and custom-plan creation, reader-driven progress, manual Mark done, archive/replace, streaks, and reopening in a signed-in workflow. The screen and shared model already exist.
- [ ] **Atlas:** canonical offline queries and signed native tests pass, as do three public-harness iOS navigation cases and bounded Mac People/Timeline/reader long-scroll flows. Recheck the final clean Mac build after diagnostics/trials are removed, then prove a real offline cold start plus remaining ranked search/chapter and full navigation acceptance on both Apple apps. Neither UI receipt claims network-disabled operation. Missing-bundle errors must stay explicit, without silent online fallback.
- [ ] **Study Bible notes loop and Alive/LC Greek:** exercise the Notes tab/indicators plus the implemented append picker; verify all four Alive books, edition carry/fallback, LC Greek display, and verse actions.
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
- **Atlas offline scope, revised 2026-10-28:** the former Apple online-only exception is superseded by the user’s explicit “Include offline Atlas” approval. Android and both Apple apps now bundle the same reviewed data and canonical core; Apple runtime/distribution proof remains in section 2.4. Web remains API-backed; unrelated web scope is unchanged. Evidence: `macos/Shared/Atlas/BundledAtlas.swift`, `scripts/build-apple-atlas.mjs`, `mobile/src/features/atlas/atlas.ts`.
- **Permitted web supersets:** guest “Try before you sign up,” browser keyboard shortcuts, the Android APK install link, and other web-only landing/editor affordances are allowed. They are not Android or iOS defects.
- **Platform-native behavior:** sheets versus sidebar/navigation, App Store versus Play billing, Apple Calendar versus another-calendar handoff, and store-specific update rows are valid form-factor/platform adaptations when the underlying capability remains available.
- **Roadmap items absent from every client:** features planned for a later cross-client release are not parity regressions. Do not list them here until at least one supported client ships them.

---

## 4. Stale records: do not reopen these as missing features

The following should not be used as evidence of current capability gaps. Update older rows when their related feature is next touched, but keep this checklist focused on real remaining work.

- **Reading Plans:** native iOS UI and the shared plan model exist; remaining work is the full workflow proof in section 2.4.
- **iOS StoreKit:** implemented for iPhone/iPad, with 1.26.0 READY_FOR_SALE as of 2026-10-28. The open item is the latest-build physical lifecycle and next release proof, not the old rejection or a missing StoreKit implementation. macOS now offers website Subscribe/Manage and Pro-wall routes through `MacBilling`; final checkout/management runtime proof remains separate.
- **iOS editor deferrals:** toolbar undo/redo, hardware-Tab list indentation, and live Dynamic Type rescaling are documented as completed in `macos/README.md`.
- **Support page:** `https://sureword.app/support` exists and is publicly reachable. Its outdated auth/subscription copy is separately listed in section 1.5.
- **Web notifications infrastructure:** registration, server fan-out, service-worker display, and tap handlers exist. The current gaps are deliberate-Stop suppression and real delivery proof, not a total absence of Web Push code.
- **Auth welcome and BYOK removal:** current `origin/main` contains the separate Create account/Sign in flow and removes personal-provider-key UI across the clients. Older “separate buttons pending” and “BYOK removal pending” cells are historical.
- **Android Study Bible notes loop:** already present in tagged Android source releases from `android-v1.90.0`; do not repeat the old “ships in the next Android build” claim.
- **Android Alive/LC Greek:** already present in tagged Android source releases from `android-v1.88.0` onward, with John from `android-v1.89.1`; do not repeat the old “next build” claim.
- **Older Apple environment blockers:** superseded Xcode-license/CoreSimulator statements and old iOS sermon-studies “not built” cells are not current capability evidence. Record the actual current build/test blocker instead.
- **Apple remote push:** entitlements, direct APNs source and environment-specific credentials are prepared; both additive migrations are applied and the session-bound server is READY. Closed-app guarded delivery and bounded Stop receipts supersede the blanket runtime-pending claim. Actual SDK sign-out local cleanup is proved, but `disconnected=false` made the first server completion inapplicable to guard verification; a forced-disconnect repeat is pending. Final clean Mac acceptance/notarization, morning delivery, manual taps, migration/failure cases and physical iOS acceptance remain open.
- **iOS inline references:** the 2026-10-28 implementation supersedes the original missing-source finding. Older checkmarks still do not close the final running-app acceptance row in section 1.3.
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
