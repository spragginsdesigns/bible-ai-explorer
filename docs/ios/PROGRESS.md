# iOS launch progress

Tracker for `docs/ios/IOS-APP-STORE-PRD.md`. One row per requirement ID. Status
values: `todo`, `source` (code exists, never exercised), `wip`, `verified`
(run in the simulator against production as the reviewer account, evidence
linked), `device` (verified in simulator, device gate still open), `deferred`
(only with Austin's written approval). Baseline 2026-10-07: iOS 1.9.0 (10),
Android bar 1.79.0 (88).

## Step 0 decisions (defaults in force until Austin objects)

| Question | Status |
|---|---|
| (a) Paid Apple Developer Program | **Confirmed and verified 2026-10-07.** Team account is LineCrush Inc. The only active Team API key is `7DQ48J77LB` (name "LineCrush", Admin), Issuer ID `cba57450-1b28-47ea-9be9-98c9125afeab` (an identifier, not a secret; the `.p8` stays in `~/.appstoreconnect/private_keys`). Read-only API calls returned 200. The account holds one app (`LineCrush: Sports Research`, `com.linecrush.ios`), three Development certificates and **no Distribution certificate and no SureWord bundle ID yet** (H1 creates both). `AuthKey_TYXHYTQZ5T` is not on the team's active list. Austin confirmed 2026-10-07: SureWord lives in the LineCrush Inc account (developer Austin Spraggins, publisher LineCrush Inc). |
| (b) Billing | Austin: "whatever Apple docs say; StoreKit if simpler". Decision: v1.0 ships with no purchase UI (compliant under 3.1.1, simplest); StoreKit 2 is F2 right after approval. |
| (c) AI consent form | Austin: one-time sheet before first AI request. |
| (d) Review demo account | Austin: none exists, we create one. Plan: dedicated password Clerk account on production, credentials stored in 1Password by Austin, never in the repo. **Austin 2026-10-07: grant it Pro via `PRO_USER_IDS`.** |
| (e) Scope before submission | **Austin 2026-10-07: full PRD first** (offered a compliant-v1.0-now option and declined). Nothing is deferred to 1.x without his written approval. |
| (f) Billing risk found 2026-10-07 (**Austin 2026-10-07: build StoreKit into v1.0**) | Guideline 3.1.3(b) (multiplatform services) lets an app unlock web/Play purchases only if the same items are also offered as in-app purchases. F1 (Pro unlocks on iOS with no StoreKit) is therefore a likely rejection. Recommendation: pull F2 StoreKit into v1.0. **Awaiting Austin.** |

## Requirements

| ID | Lane | Status | Evidence |
|---|---|---|---|
| A1 account deletion (server + 4 clients) | store-blockers | source on all four clients 2026-10-07: Apple `87e1411`, Android `58261cd` (1.80.0, release running), web `6df23f4` (deployed). Same copy and 500/502/401 handling everywhere; Apple 6 + Android 13 + web 9 tests. Not yet run against a real account (needs a throwaway account) | `macos/Shared/Settings/AccountDeletion.swift`, `mobile/src/features/settings/accountDeletion.ts`, `src/lib/account-deletion-client.ts` |
| A2 Sign in with Apple | store-blockers | todo | |
| A3 password sign-in | store-blockers | todo | |
| A4 AI disclosure and consent | store-prep | wip: copy approved by Austin 2026-10-07 (as drafted in `docs/ios/ai-consent.md`); client sheet + server consent field not built yet. Review path for reported AI output is live: `/admin/feedback` (owner-only via `ADMIN_USER_IDS`, migration `20261007140000_feedback_review_queue` applied to production neondb 2026-10-07, signed-out 404 verified on sureword.app) | `docs/ios/ai-consent.md`, `src/app/admin/feedback/` |
| A5 PrivacyInfo.xcprivacy | store-blockers | source: `39c8dda` adds `Shared/Resources/PrivacyInfo.xcprivacy` to both apps (email, user ID, other user content, sensitive info for testimony, audio, photos; UserDefaults CA92.1, system boot time 35F9.1); no manifest warnings in either build. Clerk/PhoneNumberKit ship their own; Nuke (via ClerkKitUI) has none, Clerk never calls its DataCache. Confirm at first ASC upload | `macos/Shared/Resources/PrivacyInfo.xcprivacy` |
| A6 ITSAppUsesNonExemptEncryption | store-blockers | source: `39c8dda`, key false on both app targets, present in built Info.plists | `macos/project.yml` |
| A7 privacy/terms/support pages | store-prep | verified live 2026-10-07: `/privacy`, `/terms`, `/support` (200, public) deployed with `3456561`; tests forbid price/Pro/purchase text on /privacy and /support. Apple Settings → About links Privacy Policy and Support only (`74b1925`) | `src/lib/marketing/legal-content.ts` |
| B1 four sign-in paths on device | store-blockers | todo | |
| B2 `x-sureword-client` header | ports | verified in code and tests (iOS suite + macOS build green on merged main 2026-10-07); header on the wire not yet observed | `ClientHeaderTests` |
| B3 analytics parity | ports | source: `e3b37d9` direct PostHog batch client on iOS + macOS, Android event names, property allowlist (no content keys), debug/simulator flagged as test traffic; mirror test reads server + Android sources. Queue flushed on a simulator launch (200 from PostHog not proven). Privacy manifest gained Product Interaction + Other Diagnostic Data (Analytics) | `macos/Shared/Analytics/` |
| B4 Send feedback | ports | source: `0cdfb97` same `POST /api/feedback`, categories and 2000-char limit as Android; simulator screenshot via harness; not sent signed in | `macos/Shared/Settings/Feedback.swift` |
| B5 settings hub + testimony | breadth | source (sections present, nested hub missing) | |
| B6 notifications / APNs | store-prep | source (`PushRegistration.swift`, no entitlement) | |
| B6a deferred permission prompt | breadth | todo | |
| B7 offline cold start, cache hygiene | store-blockers | todo | |
| C1 two-tier verse sheet | reader | device: signed-in simulator run 2026-10-07 against production: peek with AI teaser, Study → Explain full answer (1 Timothy 2:5). Selection rules mirror `verse-selection.test.mjs`. Found: the reader does not scroll the selected verse above the peek sheet (G2 fix) | `docs/ios/evidence/signed-in-2026-10-07/04-peek.png`, `05-study.png` |
| C2 Words tab | reader | device: signed-in simulator 2026-10-07, Greek TR word-by-word for 1 Timothy 2:5 loaded from production | `docs/ios/evidence/signed-in-2026-10-07/06-words2.png` |
| C3 See also | reader | device: live `/api/bible/crossrefs` data in simulator (lane run) | `docs/ios/evidence/reader/04-study-see-also-kjv-dark.png` |
| C4 parchment reader surface | reader | device: light/dark parchment rendered in simulator (lane run) | `docs/ios/evidence/reader/01-*.png`, `02-*.png` |
| C5 BSB + translation-aware search | reader | device: BSB 66 books bundled (5.3 MB compact, 31,102 verses test), search fallback shown in simulator. macOS now lists BSB but renders it plain and searches KJV only (parity follow-up) | `docs/ios/evidence/reader/06-*.png` |
| C6 Continue reading | reader | device: signed-in simulator 2026-10-07 shows the account's real last chapter (1 Timothy 2) and opens it | `docs/ios/evidence/signed-in-2026-10-07/01-s1.png`, `03-reader.png` |
| C7 Reading plans | breadth-1 | source: screens + Bible home card merged `81e5a6d`; card visible signed in; plan flows not yet exercised | `docs/ios/evidence/signed-in-2026-10-07/01-s1.png` |
| C8 Learn a verse | breadth-1 | device (partial): signed-in simulator shows the account's queue (John 3:3 NKJV), four practice modes, live Suggested for you; verse sheet Learn opens it. Review/offline/conflict paths covered by ported tests, not yet driven by hand | `docs/ios/evidence/signed-in-2026-10-07/02-learn.png` |
| C9 Atlas incl. Family/Trace | verify | source | |
| C10 Reading log | verify | source | |
| C11 Sermon studies | breadth-1 | source: merged `1a37aa7`; Bible home row visible signed in (church has studies); study view not yet opened | `docs/ios/evidence/signed-in-2026-10-07/01-s1.png` |
| D1 history search/rename/delete | breadth-1 | source: rename (60-char server limit; Android allows 120, which the server rejects) and failed-delete restore merged `92d5359`; not yet driven by hand | |
| D2 run-options picker | verify | source | |
| D3 receipt/copy/feedback/share + activity card | verify | source | |
| D4 Daily Cross + on-demand Listen | reader | source (Stay/Fresh); narrator/delivery todo | |
| D5 slash commands, attachments | verify | source | |
| D6 `/check`, `/reply` | share-voice | source | |
| D7 voice messages | share-voice | source (MIME types only) | |
| D8 Share Extension | share-voice | todo | |
| D9 image downscale | ports | wip: unit-tested with synthetic images; real picker/camera run pending; clipboard-paste path not covered | `ImageDownscaleTests` |
| E1 template picker | ports | source: `54c332d` byte-for-byte port of `noteTemplates.ts` (fixtures); not run signed in | |
| E2 editor menu + Markdown export | ports | source: `54c332d` chrome + More menu; `NoteMarkdownExport` equals the TS on 34 fixtures; not run signed in | |
| E3 wikilinks, backlinks, properties | notes | source: merged `d9d881a` (picker, info sheet with links/aliases/properties; parsing pinned by ports of `wikilinks.test.ts` and `noteProperties.test.ts`); iOS 129+128 and macOS 663 tests green on main. Not yet run signed in. macOS has the model but no screens | |
| E4 editor deferrals | notes | source: all three closed on iOS `f951def` (undo/redo history incl. Cmd-Z/shake, hardware Tab indent, live Dynamic Type); not yet run on a device | |
| F1 no purchase UI | store-prep | wip: audit 2026-10-07 found no purchase button, price or web link in Apple sources. Fixed: server voice-quota copy drops Pro for `ios` (`12667a0`). Fixed: Listen lock copy neutral on all four clients (`1f03066`); in-app Privacy/Support links (`74b1925`). See (f) for the 3.1.3(b) risk. | |
| F2 StoreKit | post-1.0 | deferred to after approval (PRD) | |
| G1 design audit | design | todo | |
| G2 design fixes | design | todo | |
| G3 iPad layout | design | todo | |
| G4 reader typography | design | todo | |
| G5 accessibility | design | todo | |
| G6 icon and launch | design | todo | |
| G7 widgets | stretch | todo | |
| G8 iPad keyboard shortcuts | stretch | todo | |
| H1 App ID, certs, ASC record | store-prep | wip: App ID `com.spragginsdesigns.sureword` registered 2026-10-07 (ASC id `K8YQ7UKAL7`, UNIVERSAL, team `389LLKGY3Y`) with Sign in with Apple, Push, App Groups, In-App Purchase. Apple Distribution certificate `QQZKYAB86N` (LineCrush Inc, expires 2027-10-07) created via API and imported into this Mac's login keychain; key+cert also in `~/.appstoreconnect/sureword-dist/` (mode 700, never in the repo). App Store Connect app record: API cannot create apps, Austin creates it in the web UI. App Store profile: created by `release-ios.sh` (H2). | |
| H2 `release-ios.sh` | store-prep | verified (local export) 2026-10-07: `bash macos/release-ios.sh --no-upload` created/installed the App Store profile via the API, archived Release and exported `SureWord.ipa` signed `Apple Distribution: LineCrush Inc (389LLKGY3Y)`, `get-task-allow` false, `beta-reports-active` true, PrivacyInfo + embedded profile present. Upload path waits on the ASC app record (Austin). Share-extension profile is wired in once that target lands. No `SureWord.ipa` on GitHub Releases: an App Store-signed IPA cannot be installed from a link | `macos/release-ios.sh`, `macos/scripts/asc.py` |
| H3 listing copy | store-prep | wip: drafted, lengths measured; in-flight feature lines kept as HTML comments by PRD row; 13+ override and the UGC answer need Austin | `docs/ios/app-store-listing.md` |
| H4 screenshots | store-prep | todo | |
| H5 App Privacy answers | store-prep | wip: drafted with the PrivacyInfo.xcprivacy mapping for A5; assumes B3, B4, B6, D7 and A1 ship | `docs/ios/app-privacy.md` |
| H6 review notes | store-prep | wip: template with a claim-by-claim verification gate; contact phone TODO | `docs/ios/review-notes.md` |
| H7 TestFlight | store-prep | blocked on (a) | |
| H8 submit | Austin | Austin-only gate | |

Statuses marked `source` come from a grep audit, not from running the app.
