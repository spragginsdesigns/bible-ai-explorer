# SureWord for Android

The native Android app for **SureWord** — a KJV Bible study companion that
answers from a believing perspective, quotes Scripture word-for-word, writes
into your study notes on request, and remembers you between conversations.

**This is the primary SureWord client and the source of truth for
features.** New features land here first — and the web app
(sureword.app), macOS app, and iOS source MUST be brought to capability parity
in the same release cycle. A follower may be a superset, never a subset. The parity rule
lives in `CLAUDE.md`; the feature-by-feature tracker is `docs/PARITY.md` —
update it on every feature release. The web app links to this app's APK on
GitHub Releases (see the release checklist) so web users can install it.

**Current release:** 1.40.0 (Android versionCode 38, tag
`android-v1.40.0`). The release gives the Chat composer balanced clearance
above the navigation bar, a unified lighter surface, and a restrained halo. It
is published from one signed AAB/APK pair through `push-phone.sh --skip-build`.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Expo SDK 57 / React Native 0.86, TypeScript strict |
| Navigation | expo-router v7 (Stack + custom glass tab bar) |
| Auth | Clerk (`@clerk/expo`) — email-code + Google SSO; tokens in SecureStore |
| AI chat | Vercel AI SDK v7 (`@ai-sdk/react` useChat + `expo/fetch` streaming) |
| Rich text | `@10play/tentap-editor` (Tiptap-compatible; HTML round-trips with the web editor) |
| Markdown | react-native-markdown-display with custom Scripture blockquote styling |
| Backend | The existing Next.js API on Vercel — no mobile-specific backend |

The app talks to `https://sureword.app/api/*` with a Clerk
Bearer token (`src/lib/api.ts`). Chat, tools (scripture search, exact passage
lookup, web search, note-writing), user memory, and persistence are all
server-side, shared 1:1 with the web app and the same database.

## Design system

Dark monochrome glassmorphism ported token-for-token from the web CSS —
see `src/theme/index.ts`. Pirata One for the wordmark, Cormorant Garamond for
quoted Scripture, amber accents, glass cards on a black mesh gradient. No
stock Material components; every surface is built from the theme tokens.

## Project layout

```
mobile/
├── app/                    # expo-router routes
│   ├── (auth)/sign-in.tsx  # email-code + Google sign-in
│   └── (app)/              # authenticated routes and glass tab bar
│       ├── index.tsx       # Chat
│       ├── cross.tsx       # Pick Up Your Cross + Listen
│       ├── bible/          # reader, search, plans, Timeline/People/Places
│       ├── notes/          # notes library and rich editor
│       ├── memories.tsx    # memory manager
│       └── settings.tsx    # appearance, church, notifications, providers
├── src/
│   ├── components/ui.tsx   # Screen, GlassCard, BrandTitle, buttons
│   ├── theme/              # design tokens
│   ├── lib/                # api client, chat view-model (ported from web)
│   └── features/
│       ├── chat/           # streaming chat, tool cards, slash commands, attachments
│       ├── bible/          # bundled reader, translations, highlights
│       ├── atlas/          # Timeline, People & Places
│       ├── cross/          # Listen and Daily Cross presentation
│       ├── plan/           # Reading Plans
│       ├── church/         # My church settings section
│       ├── notes/          # library, TenTap editor, note AI panel
│       └── memories/notifications/settings/updates/
└── scripts/
    ├── push-phone.sh     # bump + build + publish to Play and GitHub
    ├── build-aab.sh      # signed all-ABI AAB plus website APK
    ├── play-upload.mjs   # Android Publisher API uploader (no deps)
    └── release-apk.sh    # attach the built APK to a GitHub release
```

## Development

```bash
cd mobile
npm install          # NOT pnpm - mobile is intentionally outside the workspace
npx expo start       # dev server (Expo Go won't work - native modules; use a dev build)
```

### Building release artifacts (Windows / Git Bash)

Run these commands in Git Bash from the repository root. WSL is not supported for
the Android build environment; it can inject Linux SDK and `JAVA_HOME` paths.

```bash
(cd mobile && npx expo prebuild --platform android) # regenerates android/ (gitignored)
bash mobile/scripts/build-aab.sh       # upload-signed AAB + matching website APK
```

The Android release flow is the primary acceptance path. `build-aab.sh` runs
both Gradle release tasks so the Play AAB and the website APK come from the
same source build. Do not publish the APK separately during a normal release.
For a local-only sideload build, direct Gradle commands are allowed after
prebuild, but the generated project uses the debug keystore; never upload that
output to Play or GitHub. `build-aab.sh` patches the upload key and rejects a
debug-signed AAB.

Known Windows gotchas (all pre-solved in the checked-in config):

- **CMake 3.22.1 (the SDK default) is broken here** — endless
  `ninja: manifest 'build.ninja' still dirty` loops. `cmake.dir` pins 3.31.6.
- **An inherited `JAVA_HOME` pointing at JDK 24+ breaks the build** — every
  `configureCMake*` task fails with `WARNING: A restricted method in
  java.lang.System has been called` (hit 2026-08-16 with the machine-wide
  `JAVA_HOME=C:\Java\current` = JDK 25). `push-phone.sh` *respects* an existing
  `JAVA_HOME`, so override it for the invocation:
  `JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" bash mobile/scripts/push-phone.sh`
  (the JBR is JDK 21, which AGP supports).
- `reactNativeArchitectures=arm64-v8a` in `gradle.properties` — phone builds
  only need arm64; switch to `x86_64` for emulator testing (wipe `.cxx` dirs
  in node_modules when switching).
- Direct Gradle release builds sign with the debug keystore - fine only for a
  local sideload. `build-aab.sh` signs the Play/GitHub artifacts with the
  external upload key and fails closed if the AAB is still debug-signed.
- **The `expo-audio` config plugin writes the media-playback service into
  `AndroidManifest.xml`** (`enableBackgroundPlayback: true` in `app.json`, since
  1.32.0). It adds `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and
  `expo.modules.audio.service.AudioControlsService`. Nothing in JS can add those,
  so a JS-only build leaves Listen dying with the screen and shows no media
  notification - **a prebuild is mandatory for that feature to work at all**.
  After one, confirm with:
  `grep -c FOREGROUND_SERVICE_MEDIA_PLAYBACK android/app/src/main/AndroidManifest.xml`
  (expect `1`). `recordAudioAndroid: false` must stay - SureWord records nothing,
  and the manifest's `RECORD_AUDIO` line carries `tools:node="remove"`, which is
  the *removal* directive, not a granted permission.

### Pushing to the phone

Run from the repository root in Git Bash:

```bash
bash mobile/scripts/push-phone.sh                  # bump + build + publish Play and GitHub APK
bash mobile/scripts/push-phone.sh --skip-build     # publish one previously bound AAB/APK pair, no bump
```

Since 2026-08-19 this targets the Play Store's internal testing track (normally
available to testers within minutes, with no review) instead of wireless ADB -
the phone updates itself. After the Play upload succeeds, the same command
publishes the matching `SureWord.apk` to GitHub Releases, which refreshes the
APK served by the website download link. `build-aab.sh` writes a version and
SHA-256 manifest for both artifacts; `push-phone.sh` verifies it before any
Play upload, including `--skip-build`, so stale or independently built files
fail closed.

**Mandatory (since 2026-08-20): write the `CHANGELOG.md` entry first.** The
changelog is the single source of truth for Play "What's new" notes - the
script extracts the release text from the entry for the versionCode being
published and **refuses to build or upload without one** (rules at the top of
`CHANGELOG.md`; ad-hoc notes arguments are rejected).

Plumbing and failure modes are documented in
`.claude/skills/push-phone/SKILL.md` and `docs/PLAY_STORE.md`. The old
ADB-sideload script lives in git history if a debug build ever needs it.

## Release checklist

1. Bump `version` in `app.json` and add a `CHANGELOG.md` entry (heading format
   and the mandatory Play-notes block per the rules at the top of that file).
   The website discovers the newest `android-v*` release containing
   `SureWord.apk`, so it needs no separate Android version edit.
2. `npx tsc --noEmit` clean.
3. Test on the emulator when the change is risky (AVD `SureWord_Test`).
4. Treat Android as the primary acceptance path: run
   `bash mobile/scripts/push-phone.sh`. It bumps `versionCode`, publishes the
   signed AAB to the Play internal track, then publishes the matching APK to
   GitHub Releases. The website download link refreshes from that same release;
   no manual website version edit or second APK publish is needed.
   The script tags `android-v<version>`, attaches the APK under the fixed asset
   name `SureWord.apk`, and re-attaches the other platforms' current assets
   (`SureWord.dmg`, `SureWord.ipa` when it exists). Since "latest" is one
   release, every release must carry every platform asset. Never rename them.
5. Commit `mobile/` changes (the generated `android/` dir stays gitignored).
