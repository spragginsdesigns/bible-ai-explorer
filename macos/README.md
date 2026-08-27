# SureWord for macOS and iOS

Native SwiftUI clients for macOS 15+ and iOS 26+. The third and fourth
first-class clients alongside the Android app (`mobile/`) and the web app
(`src/`), talking to the **same** Next.js backend at `https://sureword.app` —
there is no Apple-specific server code, and nothing here needs deploying.

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

`SureWord-iOS` is a second app target in the same generated project. Everything
platform-neutral lives in `macos/Shared/` and is compiled into **both** targets
(same-module sharing, so no imports change); only the shells are per-platform —
`macos/SureWord/` keeps the macOS app/window/views, `macos/SureWord-iOS/` holds
the iOS `@main` app and, as later lanes land, its views. The AppKit-coupled
notes editor (`NoteRichTextController`, `NoteTextView`, `NoteEditorTextView`,
`NoteAttributedText`) stays macOS-only in `SureWord/Notes/RichText/`; the iOS
build compiles `NoteEditorModel` without a controller until a native iOS editor
exists.

```bash
cd macos && xcodegen
xcodebuild -scheme SureWord-iOS \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath build-ios.noindex build
# tests (SureWord-iOSTests — only a sanity test so far; the macOS suite
# is ported by a later lane):
xcodebuild -scheme SureWord-iOS \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath build-ios.noindex test
```

The iOS target shares the bundle id `com.spragginsdesigns.sureword` and the
signing settings above. iOS signing for devices will need the usual provisioning
work; simulator builds need none.

## Signing, the sandbox, and the keychain

These three are entangled, and getting any one wrong makes the app launch with
**no window and no error** — it just sits in `ps` doing nothing. The working
combination is:

| Setting | Value |
|---|---|
| `CODE_SIGN_STYLE` | `Manual` |
| `CODE_SIGN_IDENTITY` | `Apple Development` |
| `DEVELOPMENT_TEAM` | `389LLKGY3Y` |
| App Sandbox | **off** |
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

To notarize and distribute later, enrol in the Apple Developer Program, set
`CODE_SIGN_STYLE: Automatic`, and re-add the sandbox entitlements
(`app-sandbox`, `network.client`, `files.user-selected.read-only`) via a
provisioning profile.

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
├── Settings/     Persisted appearance + translation, memory toggle
├── Resources/    Brand fonts (Pirata One, Cormorant Garamond)
└── DesignSystem/ Theme tokens and shared views

SureWord/       macOS-only shell:
├── App/          SureWordApp (@main), MainWindow shell, menu commands
├── Bible/Views/  Reader panes
├── Chat/Views/   Cards, bubbles, input bar
├── Notes/        AppKit editor (NoteRichTextController, NoteTextView,
│                NoteEditorTextView, NoteAttributedText) + views
├── Assets.xcassets  App icon (generated by scripts/apply-logo.py) + accent
└── Info.plist

SureWord-iOS/   iOS-only shell: SureWordIOSApp (@main) + placeholder RootView.
SureWord-iOSTests/  iOS test host (sanity test only, for now).
```

Most Swift types are direct ports of a named TypeScript file, noted in each
file's header — e.g. `Chat/ChatViewMessage.swift` ports
`mobile/src/lib/chatView.ts`. The Vitest suites for those files were ported
alongside them into `SureWordTests/`, so behaviour is pinned to the other
clients rather than re-derived. **If you change one side, change both.**

The exception is `Networking/UIMessageStream.swift`: the AI SDK's transport does
this job in the TS clients, so the SSE decoding and `UIMessage` assembly are
written from the protocol spec and covered by recorded-chunk tests.

## Releasing a DMG

Distribution is a DMG attached to a GitHub release. The normal path is
`bash macos/install-mac.sh --release`, which builds Release, installs the
same build to `/Applications`, then runs the two steps below. By hand:

```bash
cd macos && xcodegen
xcodebuild -project SureWord.xcodeproj -scheme SureWord -configuration Release \
  -destination 'platform=macOS' -derivedDataPath build-release.noindex build

../scripts/build-dmg.sh          # styled installer → macos/SureWord.dmg
bash ./release-dmg.sh
```

`release-dmg.sh` refuses a missing or empty `SureWord.dmg`, reads
`MARKETING_VERSION` from `project.yml`, mounts the DMG read-only and verifies
the bundled app reports that exact version, requires authenticated `gh`, creates
the `macos-v<version>` tag/release, and uploads the fixed asset name
`SureWord.dmg`. It also carries the current `SureWord.apk` (and `SureWord.ipa`
once iOS distribution exists) forward, so persistent
`releases/latest/download/<asset>` links cannot break when a macOS release
becomes latest. Re-running it updates that tag and replaces the assets, so an
interrupted upload can be retried safely. The script performs no build; running
it is the explicit action that creates or updates the GitHub release.

`build-dmg.sh` (requires `brew install create-dmg`) lays out the branded
installer window: the committed art lives in `macos/dmg/` — a HiDPI
`background.tiff` composed by `scripts/make-dmg-background.py` from the
AI-generated dawn plate (`backdrop-raw.png`) plus the crisp brand layer
(wordmark, 2 Peter 1:19 tagline, drag arrow, first-launch hint), and the
volume icon `SureWord.icns` built from the appiconset. Two invariants:
Finder draws icon labels in *black* whenever a background picture is set,
so the art pools light under both label zones — keep that if you re-art it;
and the icon coordinates in `build-dmg.sh` must match the arrow/pools in
`make-dmg-background.py`.

Set `MARKETING_VERSION` in `project.yml` before building. The site resolves
the newest `macos-v*` GitHub release that contains `SureWord.dmg`, so no
manual website version constant bump or manual cross-platform asset
re-attachment is needed. The build is signed with the local Development certificate but **not
notarized** (needs the paid Apple Developer Program). macOS 15 removed the
right-click→Open bypass for unnotarized apps, so a downloaded copy's first
launch is: open (blocked) → Done → System Settings → Privacy & Security →
**Open Anyway** — or `xattr -dr com.apple.quarantine
/Applications/SureWord.app`. The release script includes this first-launch
note, and the DMG background bakes the same hint in.

## Status

At 1:1 parity with Android v1.16.0 as of 2026-08-17 (macOS 1.3.0): chat
(streaming, tools, slash commands, verse/file attachments, save-to-note),
Bible reader with Tap-a-verse, "Pick Up Your Cross", Notes, Memories and
Settings. The one outstanding gap is Android 1.11.0/1.12.0's BYOK provider
settings and model picker — until that lands, macOS sends no `modelId` and the
server falls back to the account default. `docs/PARITY.md` tracks every feature
row across all three clients — keep its macOS column current.

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
words. Copy lives in the verse panel and the context menu instead.

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
