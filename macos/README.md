# SureWord for macOS

Native SwiftUI client for macOS 15+. The third first-class client alongside the
Android app (`mobile/`) and the web app (`src/`), talking to the **same**
Next.js backend at `https://sureword.app` — there is no macOS-specific server
code, and nothing here needs deploying.

Per the parity rule in `CLAUDE.md`, Android leads and every client follows.
Layout adapts to the form factor (sidebar and menu bar instead of a bottom tab
bar), but no capability may be missing.

## Build and run

```bash
cd macos
xcodegen                                  # regenerate SureWord.xcodeproj
xcodebuild -scheme SureWord -destination 'platform=macOS' \
  -derivedDataPath build build
open build/Build/Products/Debug/SureWord.app
```

Tests:

```bash
xcodebuild -scheme SureWord -destination 'platform=macOS' \
  -derivedDataPath build test
```

Or just open `SureWord.xcodeproj` in Xcode after running `xcodegen`.

**`SureWord.xcodeproj` is generated and gitignored.** `project.yml` is the source
of truth — run `xcodegen` after pulling or after adding a directory. Requires
`brew install xcodegen`.

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
SureWord/
├── App/          SureWordApp (@main), AppModel, MainWindow shell, menu commands
├── Auth/         ClerkKit sign-in, token bridge, Clerk theming
├── Networking/   APIClient, SSE + UI-message-stream decoder, JSONValue
├── Chat/         Message model, view model, cards, views, file attachments
├── Bible/        Reader, bundled KJV data, NKJV fetch, offline search
├── Notes/        Notes list, lossless HTML rich-text editor, per-note AI
├── Memories/     Memory management (list, add, delete, summary)
├── Settings/     Persisted appearance + translation, memory toggle
├── Resources/    Brand fonts (Pirata One, Cormorant Garamond)
├── Assets.xcassets  App icon (generated by scripts/apply-logo.py) + accent
└── DesignSystem/ Theme tokens and shared views
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

Distribution is a DMG attached to a GitHub release. The web app links
`releases/latest/download/SureWord.dmg` (see `src/lib/constants.ts`), so
**every release must attach its DMG under the fixed asset name
`SureWord.dmg`** or the site's download link breaks.

```bash
cd macos && xcodegen
xcodebuild -project SureWord.xcodeproj -scheme SureWord -configuration Release \
  -destination 'platform=macOS' -derivedDataPath build-release build

../scripts/build-dmg.sh          # styled installer → macos/SureWord.dmg

gh release create macos-v<version> SureWord.dmg \
  --title "SureWord for macOS <version>" --notes "..."
# (or replace the asset on an existing release: gh release upload <tag> SureWord.dmg --clobber)
```

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

Bump `MARKETING_VERSION` in `project.yml` first. The build is signed with the
local Development certificate but **not notarized** (needs the paid Apple
Developer Program). macOS 15 removed the right-click→Open bypass for
unnotarized apps, so a downloaded copy's first launch is: open (blocked) →
Done → System Settings → Privacy & Security → **Open Anyway** — or
`xattr -dr com.apple.quarantine /Applications/SureWord.app`. Say so in the
release notes; the DMG background bakes the same hint in.

## Status

Feature-complete at 1:1 parity with Android v1.10.0 as of 2026-08-12: chat
(streaming, tools, slash commands, verse/file attachments, save-to-note),
Bible reader, Notes, Memories and Settings. `docs/PARITY.md` tracks every
feature row across all three clients — keep its macOS column current.

Two testing hazards worth knowing before driving the app programmatically:

- All local builds share the bundle id, so `open` may just activate someone
  else's running instance. Use `open -n <path>`, find the pid by matching the
  executable path in `ps`, and script it via System Events
  `first application process whose unix id is <pid>`.
- The unit tests run inside the app (`TEST_HOST`), so anything that touches
  `UserDefaults.standard` in a test is touching the real app domain — inject a
  suite instead (see `BibleModelTests`).
