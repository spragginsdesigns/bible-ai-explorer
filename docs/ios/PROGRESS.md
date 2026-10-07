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
| (f) Billing risk found 2026-10-07 | Guideline 3.1.3(b) (multiplatform services) lets an app unlock web/Play purchases only if the same items are also offered as in-app purchases. F1 (Pro unlocks on iOS with no StoreKit) is therefore a likely rejection. Recommendation: pull F2 StoreKit into v1.0. **Awaiting Austin.** |

## Requirements

| ID | Lane | Status | Evidence |
|---|---|---|---|
| A1 account deletion (server + 4 clients) | store-blockers | wip: server live (unauth DELETE returns 401 in production 2026-10-07). iOS + macOS UI merged `87e1411` (two-step confirm, typed DELETE, 500/502/401 handling; 6 macOS + iOS request tests; macOS 630 and iOS 75+51 tests green on main). Not yet run against a real account. Android + web UI in progress | `macos/Shared/Settings/AccountDeletion.swift` |
| A2 Sign in with Apple | store-blockers | todo | |
| A3 password sign-in | store-blockers | todo | |
| A4 AI disclosure and consent | store-prep | wip: sheet copy (99 words) and server contract proposed, no code; thumbs-down audit found no human-review queue (script and SQL only). Needs Austin: server enforcement phase, review digest | `docs/ios/ai-consent.md` |
| A5 PrivacyInfo.xcprivacy | store-blockers | source: `39c8dda` adds `Shared/Resources/PrivacyInfo.xcprivacy` to both apps (email, user ID, other user content, sensitive info for testimony, audio, photos; UserDefaults CA92.1, system boot time 35F9.1); no manifest warnings in either build. Clerk/PhoneNumberKit ship their own; Nuke (via ClerkKitUI) has none, Clerk never calls its DataCache. Confirm at first ASC upload | `macos/Shared/Resources/PrivacyInfo.xcprivacy` |
| A6 ITSAppUsesNonExemptEncryption | store-blockers | source: `39c8dda`, key false on both app targets, present in built Info.plists | `macos/project.yml` |
| A7 privacy/terms/support pages | store-prep | wip: policy, terms and public `/support` (+ `/support.md`) committed on the store-prep branch; lint, tsc and 1281 logic tests green; not deployed. The policy and /support describe in-app account deletion on every client, which so far exists only server-side (A1): ship A1 clients first, or accept that the email fallback both pages also state is the only working path until then | `src/lib/marketing/legal-content.ts`, `tests/llms-txt.test.mjs` |
| B1 four sign-in paths on device | store-blockers | todo | |
| B2 `x-sureword-client` header | ports | verified in code and tests (iOS suite + macOS build green on merged main 2026-10-07); header on the wire not yet observed | `ClientHeaderTests` |
| B3 analytics parity | ports | todo | |
| B4 Send feedback | ports | todo | |
| B5 settings hub + testimony | breadth | source (sections present, nested hub missing) | |
| B6 notifications / APNs | store-prep | source (`PushRegistration.swift`, no entitlement) | |
| B6a deferred permission prompt | breadth | todo | |
| B7 offline cold start, cache hygiene | store-blockers | todo | |
| C1 two-tier verse sheet | reader | todo | |
| C2 Words tab | reader | source | |
| C3 See also | reader | todo | |
| C4 parchment reader surface | reader | todo | |
| C5 BSB + translation-aware search | reader | todo | |
| C6 Continue reading | reader | todo | |
| C7 Reading plans | breadth-1 | todo (`Shared/Plan` model only) | |
| C8 Learn a verse | breadth-1 | todo | |
| C9 Atlas incl. Family/Trace | verify | source | |
| C10 Reading log | verify | source | |
| C11 Sermon studies | breadth-1 | todo | |
| D1 history search/rename/delete | breadth-1 | wip (rename missing; search/delete source) | |
| D2 run-options picker | verify | source | |
| D3 receipt/copy/feedback/share + activity card | verify | source | |
| D4 Daily Cross + on-demand Listen | reader | source (Stay/Fresh); narrator/delivery todo | |
| D5 slash commands, attachments | verify | source | |
| D6 `/check`, `/reply` | share-voice | source | |
| D7 voice messages | share-voice | source (MIME types only) | |
| D8 Share Extension | share-voice | todo | |
| D9 image downscale | ports | wip: unit-tested with synthetic images; real picker/camera run pending; clipboard-paste path not covered | `ImageDownscaleTests` |
| E1 template picker | ports | todo | |
| E2 editor menu + Markdown export | ports | todo | |
| E3 wikilinks, backlinks, properties | notes | todo | |
| E4 editor deferrals | notes | todo | |
| F1 no purchase UI | store-prep | wip: audit 2026-10-07 found no purchase button, price or web link in Apple sources. Fixed: server voice-quota copy drops Pro for `ios` (`12667a0`). Open: Listen lock copy "Self-service SureWord Pro access isn't available yet" (Apple `ListenCard.swift:60`, Android `ListenCard.tsx:505`, web `ListenCard.tsx:287`) is stale since Stripe went live; neutral wording on all clients in one cycle. In-app privacy link missing on iOS (link `/privacy`, not `/terms`, which states the price). See (f) for the 3.1.3(b) risk. | |
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
| H2 `release-ios.sh` | store-prep | todo | |
| H3 listing copy | store-prep | wip: drafted, lengths measured; in-flight feature lines kept as HTML comments by PRD row; 13+ override and the UGC answer need Austin | `docs/ios/app-store-listing.md` |
| H4 screenshots | store-prep | todo | |
| H5 App Privacy answers | store-prep | wip: drafted with the PrivacyInfo.xcprivacy mapping for A5; assumes B3, B4, B6, D7 and A1 ship | `docs/ios/app-privacy.md` |
| H6 review notes | store-prep | wip: template with a claim-by-claim verification gate; contact phone TODO | `docs/ios/review-notes.md` |
| H7 TestFlight | store-prep | blocked on (a) | |
| H8 submit | Austin | Austin-only gate | |

Statuses marked `source` come from a grep audit, not from running the app.
