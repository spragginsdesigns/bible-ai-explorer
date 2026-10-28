# SureWord for macOS and iOS

Native SwiftUI clients for macOS 15+ and iOS 26+. The third and fourth
first-class clients alongside the Android app (`mobile/`) and the web app
(`src/`), talking to the **same** Next.js backend at `https://sureword.app`.
Shared API work, including direct APNs delivery in `src/lib/apns.ts`, must be
deployed before the corresponding native clients can use it.

Per the parity rule in `CLAUDE.md`, Android leads and every client follows.
Layout adapts to the form factor (sidebar and menu bar on macOS instead of a
bottom tab bar), but no capability may be missing.

## Build and run

```bash
cd macos
xcodegen                                  # regenerate SureWord.xcodeproj
xcodebuild -scheme SureWord -destination 'platform=macOS' \
  -derivedDataPath build.noindex build
open build.noindex/Build/Products/Debug/SureWord.app
```

**Every build directory ends in `.noindex`.** Spotlight skips directories with
that suffix, so a scratch Debug build never shows up next to the real app when
Austin hits ⌘Space. Never pass a plain `build`/`build-lane2` derived-data path;
`install-mac.sh` deletes those on sight.

## Installing on this Mac (mandatory after macOS parity work)

`/Applications/SureWord.app` is the **only** SureWord.app that may exist on
this machine, and it must be the current checkout. Any macOS parity work is
not done until this has run:

```bash
bash macos/install-mac.sh             # build Release, replace /Applications/SureWord.app, launch
bash macos/install-mac.sh --release   # …and build + publish the DMG (macos-v<version>)
```

It bumps nothing itself - set `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` in
`project.yml` first when the release carries user-visible changes - but it
refuses to install a build whose `CFBundleShortVersionString` disagrees with
`project.yml`, prunes every stray build product (`macos/build*` without the
`.noindex` suffix, agent-fleet `build-lane*` dirs, `~/Library/Developer/Xcode/
DerivedData/SureWord-*`), quits the running app, strips quarantine, and finally
lists whatever Spotlight still indexes under that name so a leftover copy is
reported rather than hidden. Agents running a parallel fleet: give each lane a
`build-lane<N>.noindex` derived-data path and let this script clean up after.

Tests:

```bash
xcodebuild -scheme SureWord -destination 'platform=macOS' \
  -derivedDataPath build.noindex test
```

Or just open `SureWord.xcodeproj` in Xcode after running `xcodegen`.

**`SureWord.xcodeproj` is generated and gitignored.** `project.yml` is the source
of truth — run `xcodegen` after pulling or after adding a directory. Requires
`brew install xcodegen`.

## iOS

> **App Store page text:** name, subtitle, promotional text, description and
> keywords live in [`store-listing/app-store.md`](../store-listing/app-store.md)
> (index: [`store-listing/README.md`](../store-listing/README.md)).
> `python macos/scripts/asc.py listing check|apply` compares it with App Store
> Connect, and `release-ios.sh` reports drift on every release.

`SureWord-iOS` is a second app target in the same generated project. Everything
platform-neutral lives in `macos/Shared/` and is compiled into **both** targets
(same-module sharing, so no imports change); only the shells are per-platform —
`macos/SureWord/` keeps the macOS app/window/views, `macos/SureWord-iOS/` holds
the iOS `@main` app and its tab, Bible, Chat, Notes, and Settings views. The
AppKit-coupled notes editor (`NoteRichTextController`, `NoteTextView`, `NoteEditorTextView`,
`NoteAttributedText`) stays macOS-only in `SureWord/Notes/RichText/`; the iOS
target has its own `UITextView`-backed editor under
`SureWord-iOS/Views/Notes/Editor/`, sharing the same document model and lossless
HTML contract. The three editor deferrals it shipped with are closed: toolbar
undo/redo runs one snapshot history (`Shared/Notes/RichText/NoteEditHistory.swift`)
that Cmd-Z, three-finger swipe and shake also reach through the text view's
`NoteUndoManager`; hardware Tab / Shift-Tab nest and lift list items; and the
canvas rescales live on a Dynamic Type change.

```bash
cd macos && xcodegen
xcodebuild -scheme SureWord-iOS \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath build-ios.noindex build
# tests (SureWord-iOSTests — shell, Bible, chat/provider, deep-link, and notes
# coverage):
xcodebuild -scheme SureWord-iOS \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath build-ios.noindex test
```

The iOS target shares the bundle id `com.spragginsdesigns.sureword`.
`release-ios.sh` provides the signed archive/export and TestFlight upload path.
Current installation, deployment, TestFlight and App Store readbacks are
recorded in `../docs/PARITY.md`; source version alone is not publication proof.
Hosted simulator
tests that use Clerk require the signed test path; an unsigned compile is not
proof that a hosted app can launch. The macOS release script preserves the
other platform's fixed-name release assets independently.

## Signing, the sandbox, and the keychain

These three are entangled, and getting any one wrong makes the app launch with
**no window and no error** — it just sits in `ps` doing nothing. The working
Release configuration used by `install-mac.sh` uses Developer ID Application
and the matching production-push profile. Debug retains Apple Development
signing and local notifications. See `../docs/ios/push-design.md`.

| Setting | Value |
|---|---|
| `CODE_SIGN_STYLE` | `Manual` |
| `CODE_SIGN_IDENTITY` | Release: `Developer ID Application`; Debug: `Apple Development` |
| `DEVELOPMENT_TEAM` | `389LLKGY3Y` |
| Hardened Runtime | **on** for the host and Share extension |
| Release debug entitlement injection | **off**, with secure timestamps enabled |
| App Sandbox | Host **off**; Share extension **on** |
| `keychain-access-groups` | **absent** |

Why each, since every one of them was arrived at by breaking it first:

- **Signing must be stable, not ad-hoc.** ClerkKit stores its session in the
  keychain, and a keychain item's ACL is bound to the app's designated
  requirement. An ad-hoc signature changes on every build, so the next build
  can't read what the last one wrote and macOS raises a consent prompt —
  presented during `Clerk.configure()`, which runs before the run loop, so it
  deadlocks with no UI.
- **The Team ID is the certificate's `OU`, not the id in its common name.**
  ```bash
  security find-certificate -c "Apple Development: Austin Spraggins" -p \
    | openssl x509 -noout -subject
  # UID=…, CN=Apple Development: … (Q79QD7L78T), OU=389LLKGY3Y
  ```
  `Q79QD7L78T` is the *certificate* id and is the wrong value.
- **No App Sandbox.** The sandbox is a Mac App Store requirement and nothing
  here ships that way. A sandboxed app signed with a Development certificate and
  no embedded provisioning profile hangs in `_libsecinit_appsandbox` before
  `main()`. Profiles need a paid membership.
- **No `keychain-access-groups`.** Naming an access group would select the
  data-protection keychain, but that entitlement also needs a provisioning
  profile: unauthorized it hangs in `_libsecinit_initializer`, and under ad-hoc
  signing every keychain call fails with `OSStatus -34018`
  (`errSecMissingEntitlement`). Clerk uses the legacy keychain instead, which
  works fine given a stable signature.

**If the app ever launches with no window**, it is almost always a stale
keychain item written by a differently-signed build. Confirm with
`sample <pid>` — look for `SecItemCopyMatching` or `_libsecinit_*` on the main
thread — then clear them and relaunch:

```bash
while security delete-generic-password -s "com.spragginsdesigns.sureword"; do :; done
```

### Austin should never type a keychain password for SureWord

The other symptom of the same problem is a **"SureWord wants to access key
com.spragginsdesigns.sureword in your keychain"** password prompt that keeps
coming back, even after Austin clicks **Always Allow** every time. That is a
bug to fix, not something to ask Austin to put up with.

The cause found on 2026-10-25: ClerkKit's four items (`clerkDeviceToken`,
`cachedClient`, `cachedClientServerDate`, `cachedEnvironment`) were created
months earlier, and their ACLs had piled up only Debug, worktree and unsigned
test builds (cdhash-pinned entries). `/Applications/SureWord.app` was never on
the list, and Always Allow never managed to add it, so every read prompted.
Inspect the ACLs (no secrets are printed):

```bash
security dump-keychain -a ~/Library/Keychains/login.keychain-db 2>/dev/null \
  | awk 'BEGIN{RS="keychain: "} /"svce"<blob>="com.spragginsdesigns.sureword"/' \
  | grep -E '"acct"|^ +[0-9]+: /|description: teamid'
```

Healthy output lists exactly `0: /Applications/SureWord.app (OK)` and
`teamid:389LLKGY3Y` for each of the four items. Anything else (build dirs,
`cdhash` entries, missing `/Applications`) needs the fix:

1. Quit SureWord (`kill -TERM <pid>`).
2. Delete the items with the loop above. This signs the Mac app out.
3. Open `/Applications/SureWord.app` and have Austin sign in once with Google
   (never click the Google consent yourself). ClerkKit recreates the items with
   the installed app as their owner.
4. Re-run the check, then quit and relaunch: it must open signed in with no
   prompt. Verified this way on 1.25.0 (33).

Since 2026-10-25, Debug builds keep their Clerk session under the
`com.spragginsdesigns.sureword.debug` service (`SureWordApp.keychainService`),
so agent worktree builds and test hosts, signed or not, never read the
installed app's items. It happened again that day before the split: two
agents' unsigned macOS test hosts prompted, and approving them replaced the
items' `teamid:389LLKGY3Y` partition with a cdhash, so `/Applications` asked
for the login password on every launch. A Debug build starts signed out and
needs its own sign-in once.

To keep it from coming back: running unsigned or ad-hoc builds (for example
`xcodebuild test ... CODE_SIGNING_ALLOWED=NO`, which hosts the tests inside
the app) can read the same items and adds itself to their ACLs if anyone
approves its prompt. Deny those prompts, and prefer signed test runs. The
lasting fix would be the data-protection keychain, which needs the
`keychain-access-groups` entitlement and a provisioning profile (see above).

Notarization keeps manual Developer ID signing and the host's current
entitlements. It does not require enabling the host sandbox or switching to
automatic signing. Run the separate notarization command below after building;
a Developer ID signature and production-push profile alone are not a
notarization receipt.

## Clerk setup

Auth is ClerkKit (`github.com/clerk/clerk-ios`), which supports macOS 14+.
Three things must line up, and each fails *silently* when it doesn't:

1. **Native API enabled** and the bundle id `com.spragginsdesigns.sureword`
   registered under Clerk Dashboard → Native Applications. The Android client
   already uses the Native API, so it should be on.
2. **Redirect allowlist** must contain `sureword://sso-callback`. Production
   Clerk instances reject unlisted redirects by omitting the verification URL
   rather than erroring. ClerkKit's *default* redirect is
   `{bundleID}://callback`, which is **not** on the allowlist — `SureWordApp`
   overrides it explicitly, and `Info.plist` registers the `sureword` scheme.
3. **The publishable key** is `pk_live_Y2xlcmsuc3VyZXdvcmQuYXBwJA` in
   `App/Config.swift`. The key encodes its Frontend API host (base64-decode it →
   `clerk.sureword.app$`), so a key from another instance takes sign-in down
   outright. **This is the third place that must move in lockstep** with
   `mobile/app.json` and the web's `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.

Passkeys are deliberately not enabled: they need the Associated Domains
entitlement (`webcredentials:clerk.sureword.app`), which requires a paid
membership. Email code and Google OAuth need only the URL scheme.

## Layout

```
Shared/         Compiled into BOTH the macOS and iOS targets (same-module
│               sharing — no import changes either side):
├── App/          Config (Clerk key, URLs), AppModel + AppSection
├── Auth/         ClerkKit sign-in, token bridge, Clerk theming
├── Networking/   APIClient, SSE + UI-message-stream decoder, JSONValue
├── Chat/         Message model, view model, slash commands, verse/file
│                attachments (pasteboard behind #if os(macOS))
├── Bible/        Bundled KJV data, NKJV fetch, offline search,
│                Tap-a-verse explanation stream
├── DailyCross/   "Pick Up Your Cross" model + local reminder scheduling
├── Notes/        Store, models, HTML rich-text document/parser/serializer
├── Memories/     Memory management (list, add, delete, summary) + view
├── Settings/     Persisted appearance + translation, memory toggle,
│                account preferences sync, Highlight labels, About me
├── Resources/    Brand fonts (Pirata One, Cormorant Garamond)
└── DesignSystem/ Theme tokens and shared views

ShareInbox/     "Share into SureWord" inbox (manifest, store, capped copy),
                compiled into both apps and both share extensions

SureWord/       macOS-only shell:
├── App/          SureWordApp (@main), MainWindow shell, menu commands,
│                MacShareInbox (Share extension inbox, Services, window and Dock drops)
├── Bible/Views/  Reader panes
├── Chat/Views/   Cards, bubbles, input bar
├── Notes/        AppKit editor (NoteRichTextController, NoteTextView,
│                NoteEditorTextView, NoteAttributedText) + views
├── Assets.xcassets  App icon (generated by scripts/apply-logo.py) + accent
└── Info.plist

SureWord-iOS/   iOS-only shell: SureWordIOSApp (@main), RootView, TabShell, and
                native Bible, Chat, Notes, Cross, and Settings views.
SureWord-iOS-Share/  iOS Share Extension: copies a share into the App Group
                     inbox for the app to open.
SureWord-macOS-Share/  macOS Share Extension: same collector/caps, using the
                       Team-ID-prefixed Mac App Group container.
SureWord-iOSTests/  iOS test host (shell, protocol, Bible, deep-link, and notes
                    coverage).
```

Most Swift types are direct ports of a named TypeScript file, noted in each
file's header — e.g. `Chat/ChatViewMessage.swift` ports
`mobile/src/lib/chatView.ts`. The Vitest suites for those files were ported
alongside them into `SureWordTests/`, so behaviour is pinned to the other
clients rather than re-derived. **If you change one side, change both.**

The exception is `Networking/UIMessageStream.swift`: the AI SDK's transport does
this job in the TS clients, so the SSE decoding and `UIMessage` assembly are
written from the protocol spec and covered by recorded-chunk tests.

### Settings sections shared by both Apple clients

Each is one file under `Shared/Settings/`, mounted by the Mac `SettingsView`
(one form) and by the iOS Settings pages. iOS Settings is a hub with one
pushed page per category, in Android 1.69.0's order
(`SureWord-iOS/Views/Settings/SettingsView.swift` + `SettingsPages.swift`):
the profile row opens Account (sign out, delete account); then Appearance &
reading, Highlight labels, My church, Memory (with About me and My
testimony), AI (membership including the SureWord Pro StoreKit screen,
provider keys, web search), Shared answers, Notifications, Send feedback and
About. Android's Check for updates is a Play Store row and has no iOS page.

- **Highlight labels** (`HighlightLabelsSection.swift`) names each of the eight
  highlight colours and says what it means to the user, with a starter set
  behind "Use suggested labels". Both maps are stored whole by
  `PATCH /api/preferences`, so the section saves through
  `PreferencesSyncModel.saveHighlightLabels`, which re-reads the account
  document and merges only the touched colours over it.
- **About me** (`AboutMeSection.swift`) is the paragraph the user writes about
  themselves, capped at 1000 characters and read by the assistant on every
  conversation. It saves through `PreferencesSyncModel.saveAboutMe`; an empty
  box clears the column.
- **My testimony** (`TestimonySection.swift`) is how the user came to faith,
  private and read by the assistant only, capped at 2000 characters. It saves
  through `PreferencesSyncModel.saveTestimony`. Both boxes are thin wrappers
  over `PersonalTextSection.swift`, which holds the editor, draft guard, Save
  button and status line.
- **Web search** (`WebSearchSection.swift`) is the existing per-account toggle,
  written straight through like the other preferences.
- **Settings data cache** (`SettingsData.swift`, PRD B7) is the port of
  Android's `settingsData.ts`: the last AI Providers, My church and memory
  count answers, persisted per account, prefetched at sign-in, revalidated
  in place (one request per section, 35 s ceiling) and cleared with the
  other per-account caches on an account switch or sign-out. The church,
  memory and provider models paint from it on the first frame, so Settings
  works offline after one online launch. The signed-in identity itself
  survives an offline cold start through ClerkKit's own keychain-cached
  client (Android needed `__experimental_resourceCache` for the same thing).

## Releasing a DMG

Distribution is a signed, notarized DMG attached to a GitHub release. Run the
three steps separately so notarization finishes before publication:

```bash
bash macos/install-mac.sh --no-launch
bash macos/notarize-mac.sh
bash macos/release-dmg.sh
```

The first command builds Release and installs the same build to `/Applications`.
The second notarizes/staples the recorded app, packages it headlessly, then
signs/notarizes/staples `macos/SureWord.dmg`; it never publishes. It reuses
`ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_PATH`, defaulting to the existing
key metadata in `macos/scripts/asc.py`. Private key contents stay outside the
repo and are passed to `notarytool` by file path. Submission responses and
logs stay under ignored `build-release.noindex/notarization/`. A timeout does
not cancel Apple's processing; inspect the saved submission ID before retrying.
`SUREWORD_NOTARY_TIMEOUT` defaults to `30m`.

The `install-mac.sh --release` shortcut runs all three stages in order and
stops if any signing, notarization or publication gate fails. The separate
commands above also let each stage be inspected before continuing. A plain
`xcodebuild` by hand cannot be packaged for release: before building,
`install-mac.sh` snapshots a content digest of `macos/` (tests, `scripts/`,
Markdown and the publish-only release scripts excluded) and, after the build,
writes it next to the app with the app's code-signature CDHash
(`SureWord.app.build` / `SureWord.app.sources` in `build-release.noindex`).
`build-dmg.sh` refuses an app with no record, an app whose CDHash no longer
matches it (rebuilt or replaced), or one whose recorded source no longer
matches `macos/`, so a stale build can never be packaged later. Notarization
preserves that app/source identity and records the final DMG hash only after
container signing and stapling. Changing source that participates in the
digest requires rebuilding before notarizing. To retry only
the publish after an interrupted upload, `bash macos/release-dmg.sh` can be
run on its own.

`release-dmg.sh` refuses a missing or empty `SureWord.dmg`, reads
`MARKETING_VERSION` from `project.yml`, and refuses a DMG whose
`SureWord.dmg.provenance` record (carried forward by `build-dmg.sh`) is
missing, names a different DMG hash or version, or whose recorded content
digest of `macos/` no longer matches the tree (the changed files are listed).
It mounts the DMG read-only, verifies the bundled app reports that exact
version, passes `codesign --verify --deep --strict`, is signed as
`com.spragginsdesigns.sureword` by team `389LLKGY3Y`, and is the exact app
(same CDHash) the build recorded. It also requires Developer ID signatures,
secure timestamps and Hardened Runtime on both app architectures and the
Share extension, production push/App Group/calendar entitlements on the host,
the extension's sandbox/App Group, and no `get-task-allow`. Both app and DMG
must have valid stapled tickets and pass Gatekeeper assessment before the
script requires authenticated `gh`, creates
the `macos-v<version>` tag/release, and uploads the fixed asset name
`SureWord.dmg`. It also carries the current `SureWord.apk` (and `SureWord.ipa`
once iOS distribution exists) forward, so persistent
`releases/latest/download/<asset>` links cannot break when a macOS release
becomes latest. Re-running it updates that tag and replaces the assets, so an
interrupted upload can be retried safely. The script performs no build; running
it is the explicit action that creates or updates the GitHub release.

`build-dmg.sh` lays out the branded
installer window: the committed art lives in `macos/dmg/` — a HiDPI
`background.tiff` composed by `scripts/make-dmg-background.py` from the
AI-generated dawn plate (`backdrop-raw.png`) plus the crisp brand layer
(wordmark, 2 Peter 1:19 tagline, drag arrow, first-launch hint), and the
volume icon `SureWord.icns` built from the appiconset. Two invariants:
Finder draws icon labels in *black* whenever a background picture is set,
so the art pools light under both label zones — keep that if you re-art it;
and the icon coordinates in `build-dmg.sh` must match the arrow/pools in
`make-dmg-background.py`. Interactive packaging uses `create-dmg`; the
notarization command selects `SUREWORD_DMG_BACKEND=headless`, using pinned
`dmgbuild` through `uv` without Finder automation.

Set `MARKETING_VERSION` in `project.yml` before building. The site resolves
the newest `macos-v*` GitHub release that contains `SureWord.dmg`, so no
manual website version constant bump or manual cross-platform asset
re-attachment is needed. Release builds use Developer ID Application; they
become notarized only after Apple accepts the submissions and the tickets
validate. Published release notes describe the signed/notarized artifact only
after those checks pass. The existing DMG background's first-launch hint is
historical fallback copy; do not use quarantine removal to establish release
acceptance. Confirm the final downloaded installer and copied app launch
through the normal Gatekeeper path.

## Status

### Current integration checkpoint, 2026-10-28

Apple source is **1.30.0 (39)**, aligned to the Android **1.109.0 (128)**
capability cohort and curated What's New catch-up code **128**. Android source
is now **1.110.0 (129)** after a separate Android notes-editor repair.
The user-approved reconciliation preserves
the upstream creator/ASV changes and all six parity lanes. A 112-entry byte
audit found no omitted source; 20 deltas already existed in newer main.
Capabilities include chat references/composer/errors/attachments, reader note
selection and audio controls, bundled ASV, Atlas/Connections/Study navigation,
Settings receipts/membership, Mac Share and direct APNs on both Apple clients.
This source inventory does not certify full runtime or release parity.

Captured native Mac QA covers a live answer and reference/reader handoff,
Study/People/trace navigation, and reader-to-note intake. The corrected note
writer persisted a title entered without Return plus a body edit across
immediate navigation, refresh and reopen. Finder sharing accepted a 96-byte TXT
as an attachment; a 1 MiB + 1-byte file was rejected locally without adding an
attachment, and all three URL-share actions were exercised. These observations
do not imply complete coverage of every sharing or editor path.

Production-push signing uses the Developer ID Application identity and
`SureWord com.spragginsdesigns.sureword Developer ID Push` (`MAC_APP_DIRECT`).
The host's production APS/calendar/App Group union is separate from the Share
extension's sandbox/App Group entitlements. The Mac group is
`389LLKGY3Y.group.com.spragginsdesigns.sureword`; iOS retains its `group.` form.
Signature readback established Hardened Runtime, secure timestamps and no
`get-task-allow` on both host and extension.

Approved SureWord-topic Sandbox/Production APNs keys and six hidden
Production-scope server variables support raw-token registration with an
explicit environment; legacy iOS Expo rows remain compatible. Native Mac
authenticated registration/proof binding returned 200, unauthenticated
registration returned 401, and matching remote identity was acknowledged.
A production APNs send produced a closed-app OS delivered-notification record;
that receipt alone does not prove a visible banner, taps or the full server
answer-ready lifecycle. See `../docs/ios/push-design.md` for the protocol.

Validation logs under `/tmp/sureword-parity-takeover/` record backend
typecheck/lint exit 0, 1,825 passing logic tests with 17 skips, and a successful
234-page post-upstream build. This includes 13 regressions for the final client-response
tracker outside usage metering, plus the per-route Vercel cancellation opt-in.
The correction is pushed; deployment and closed-client replay remain separate acceptance gates. The earlier clean
backend candidate passed its gates with matching APNs source bytes. Mobile
typecheck and 1,197 tests passed before the separate Android 1.110.0 work.
Signed iOS unit coverage totals **941**:
565 XCTest executions (1 skip, 0 failures) plus 376 Swift Testing tests across
43 suites. All three final narration and initial-ASV-reader UI cases pass.
Authenticated translation-picker persistence has its own record in the parity
ledger.

`../docs/PARITY.md` is the live ledger for the installed build's source/API
target, deployment readiness, UI follow-ups, physical-device availability,
notarization, TestFlight and public release readback. Check that ledger before
calling a build current, fully accepted or published. Older release notes
below remain historical; `../docs/PARITY-TODO.md` retains the outstanding work.

### Historical release checkpoint, 2026-10-23

At that checkpoint, macOS 1.24.0 (31) was installed at
`/Applications/SureWord.app` and published as `macos-v1.24.0` on GitHub
Releases. It carries the 2026-10-23 bug hunt Apple fixes (`ecf4721`,
LC-17262, LC-17264, LC-17265, LC-17278 under LC-17258); the same build number
goes to TestFlight under iOS 1.24.0. The 1.21.0 notes below describe the
parity release those builds grew from.

### Historical parity baseline, 2026-10-19

At that checkpoint, macOS 1.21.0 was installed at
`/Applications/SureWord.app` and published as `macos-v1.21.0` on GitHub
Releases. It carries the eleven Apple parity issues (LC-16611 to LC-16621):
sermon studies and Coming up at church with Google and Apple Calendar, chat
history search, rename and confirmed delete, the two-tier verse sheet with See
also, Learn a verse, BSB headings and red letters, Continue reading and
translation-aware search, the note editor bar, menu, templates and Copy as
Markdown, wikilinks, backlinks and properties, PostHog analytics, "Your answer
is ready", and Share into SureWord from the Services menu, the window and the
Dock. A signed-in pass on 2026-10-19 exercised these in the installed app;
`docs/PARITY.md` says row by row what was seen and what still waits on Austin
(password sign-in, the notification permission, clicking a wikilink, a
Services pick from another app, a drop on the window, and PostHog arrival).

iOS 1.21.0 is a native app distributed through TestFlight (`release-ios.sh`
uploads it to App Store Connect). 1.21.0 (2) was submitted for App Store
review on 2026-10-19, SureWord's first App Store release. A signed-in simulator
pass the same day covered the reader, search, Learn, sermons and church events,
chat history, notes and the share extension; its two note fixes (`fa88546`, the
typed title in Markdown export and the body formatting bar) ship in the next iOS
build. The iOS simulator suite runs alongside the Mac suite in CI; see
`docs/PARITY.md` before describing an iOS capability as verified on a device.

### The reader is a layout minefield — read this before touching it

The chapter reader is a `LazyVStack` of custom-font `Text` inside a
`ScrollView`, and measuring it is expensive. Anything that invalidates a verse
row re-measures the whole chapter, and doing that continuously pegs the main
thread — at which point the app still *draws* (its last frame) but stops
handling clicks, stops answering the accessibility API, and starves its own
`async` work. `sample <pid>` is how you tell: a healthy reader shows **zero**
`LayoutEngineBox.sizeThatFits` frames on the main thread; a wedged one is
nothing but those. Three ways this was hit while building 1.1.0:

- **`.onHover` on every verse row** — hover tracking across a lazy list drove a
  permanent layout loop. Removed; a verse is a `Button` instead.
- **Streaming text into an open row** — every token re-measured the chapter.
  The explanation now renders in a panel *outside* the scroll view.
- **Greedy shapes that pulse** — a `Capsule` has no intrinsic size, so a
  `maxWidth: .infinity` one inside a `repeatForever` animation keeps
  re-proposing its width. The skeleton bars carry definite widths.

Also note `.textSelection(.enabled)` is deliberately **absent** from the verse
text: a selectable `Text` on macOS owns the whole text region and swallows both
left- and right-clicks, which silently made every verse action — and later
Tap-a-verse — unreachable anywhere except the few points of padding around the
words. Copy lives on the verse sheet's action bar and in the context menu
instead.

A related rule for anything streaming: a `Task` started from a `@MainActor`
method inherits that isolation, so draining `URLSession.AsyncBytes` in one runs
the whole byte loop on the main thread. `VerseInsight.snapshots` and
`UIMessageStream.lines` both hand assembly to a non-isolated task and hop back
only to publish.

Two testing hazards worth knowing before driving the app programmatically:

- All local builds share the bundle id, so `open` may just activate someone
  else's running instance. Use `open -n <path>`, find the pid by matching the
  executable path in `ps`, and script it via System Events
  `first application process whose unix id is <pid>`.
- The unit tests run inside the app (`TEST_HOST`), so anything that touches
  `UserDefaults.standard` in a test is touching the real app domain — inject a
  suite instead (see `BibleModelTests`).
- `System Events`' `click at {x, y}` frequently hits a static text and does
  nothing. `cliclick c:<x>,<y>` works, and the sidebar sections answer to
  ⌘1–⌘4. Coordinates are logical points — halve the pixel coordinates read off
  a Retina `screencapture`.
