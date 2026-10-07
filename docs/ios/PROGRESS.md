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
| (a) Paid Apple Developer Program | **Confirmed and verified 2026-10-07.** Team account is LineCrush Inc. The only active Team API key is `7DQ48J77LB` (name "LineCrush", Admin), Issuer ID `cba57450-1b28-47ea-9be9-98c9125afeab` (an identifier, not a secret; the `.p8` stays in `~/.appstoreconnect/private_keys`). Read-only API calls returned 200. The account holds one app (`LineCrush: Sports Research`, `com.linecrush.ios`), three Development certificates and **no Distribution certificate and no SureWord bundle ID yet** (H1 creates both). `AuthKey_TYXHYTQZ5T` is not on the team's active list. Open: confirm SureWord is meant to live in the LineCrush Inc account. |
| (b) Billing | Austin: "whatever Apple docs say; StoreKit if simpler". Decision: v1.0 ships with no purchase UI (compliant under 3.1.1, simplest); StoreKit 2 is F2 right after approval. |
| (c) AI consent form | Austin: one-time sheet before first AI request. |
| (d) Review demo account | Austin: none exists, we create one. Plan: dedicated password Clerk account on production, Pro-granted via `PRO_USER_IDS` only if Austin approves, credentials stored in 1Password by Austin, never in the repo. |

## Requirements

| ID | Lane | Status | Evidence |
|---|---|---|---|
| A1 account deletion (server + 4 clients) | store-blockers | todo | |
| A2 Sign in with Apple | store-blockers | todo | |
| A3 password sign-in | store-blockers | todo | |
| A4 AI disclosure and consent | store-prep | todo | |
| A5 PrivacyInfo.xcprivacy | store-blockers | todo | |
| A6 ITSAppUsesNonExemptEncryption | store-blockers | todo | |
| A7 privacy/terms/support pages | store-prep | todo | |
| B1 four sign-in paths on device | store-blockers | todo | |
| B2 `x-sureword-client` header | ports | todo | |
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
| D9 image downscale | ports | todo | |
| E1 template picker | ports | todo | |
| E2 editor menu + Markdown export | ports | todo | |
| E3 wikilinks, backlinks, properties | notes | todo | |
| E4 editor deferrals | notes | todo | |
| F1 no purchase UI | store-prep | todo (audit Pro locked panels) | |
| F2 StoreKit | post-1.0 | deferred to after approval (PRD) | |
| G1 design audit | design | todo | |
| G2 design fixes | design | todo | |
| G3 iPad layout | design | todo | |
| G4 reader typography | design | todo | |
| G5 accessibility | design | todo | |
| G6 icon and launch | design | todo | |
| G7 widgets | stretch | todo | |
| G8 iPad keyboard shortcuts | stretch | todo | |
| H1 App ID, certs, ASC record | store-prep | blocked on (a) | |
| H2 `release-ios.sh` | store-prep | todo | |
| H3 listing copy | store-prep | todo | |
| H4 screenshots | store-prep | todo | |
| H5 App Privacy answers | store-prep | todo | |
| H6 review notes | store-prep | todo | |
| H7 TestFlight | store-prep | blocked on (a) | |
| H8 submit | Austin | Austin-only gate | |

Statuses marked `source` come from a grep audit, not from running the app.
