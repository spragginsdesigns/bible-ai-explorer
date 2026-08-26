# SureWord for Android

The native Android app for **SureWord** — a KJV Bible study companion that
answers from a believing perspective, quotes Scripture word-for-word, writes
into your study notes on request, and remembers you between conversations.

**This is the primary SureWord client and the source of truth for
features.** New features land here first — and the web app
(bible-ai-explorer.vercel.app) MUST be brought to 1:1 feature parity in the
same release cycle. Web may be a superset, never a subset. The parity rule
lives in `CLAUDE.md`; the feature-by-feature tracker is `docs/PARITY.md` —
update it on every feature release. The web app links to this app's APK on
GitHub Releases (see the release checklist) so web users can install it.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Expo SDK 57 / React Native 0.86, TypeScript strict |
| Navigation | expo-router v7 (Stack + custom glass tab bar) |
| Auth | Clerk (`@clerk/clerk-expo`) — email-code + Google SSO; tokens in SecureStore |
| AI chat | Vercel AI SDK v7 (`@ai-sdk/react` useChat + `expo/fetch` streaming) |
| Rich text | `@10play/tentap-editor` (Tiptap-compatible; HTML round-trips with the web editor) |
| Markdown | react-native-markdown-display with custom Scripture blockquote styling |
| Backend | The existing Next.js API on Vercel — no mobile-specific backend |

The app talks to `https://bible-ai-explorer.vercel.app/api/*` with a Clerk
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
│   └── (app)/              # authed: chat (index), notes/, glass tab bar
├── src/
│   ├── components/ui.tsx   # Screen, GlassCard, BrandTitle, buttons
│   ├── theme/              # design tokens
│   ├── lib/                # api client, chat view-model (ported from web)
│   └── features/
│       ├── chat/           # streaming chat, tool cards, slash commands
│       └── notes/          # library, tentap editor, note AI panel
└── scripts/
    ├── push-phone.sh     # bump versionCode + build AAB + release to Play internal track
    ├── build-aab.sh      # signed all-ABI Play Store AAB
    ├── play-upload.mjs   # Android Publisher API uploader (no deps)
    └── release-apk.sh    # attach the built APK to a GitHub release
```

## Development

```bash
cd mobile
npm install          # NOT pnpm - mobile is intentionally outside the workspace
npx expo start       # dev server (Expo Go won't work - native modules; use a dev build)
```

### Building the APK (Windows)

```bash
npx expo prebuild --platform android   # regenerates android/ (gitignored)
# android/local.properties must contain (forward slashes matter):
#   sdk.dir=C:/Users/Owner/AppData/Local/Android/Sdk
#   cmake.dir=C:/Users/Owner/AppData/Local/Android/Sdk/cmake/3.31.6
cd android
JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew assembleRelease -x lint
```

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
- Release builds sign with the debug keystore - fine for sideloading.
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

```bash
bash mobile/scripts/push-phone.sh                  # bump + build AAB + release to Play internal track
bash mobile/scripts/push-phone.sh --skip-build     # upload the existing AAB, no bump
```

Since 2026-08-19 this ships through the Play Store's internal testing track
(live for testers within minutes, no review) instead of wireless ADB - the
phone updates itself.

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
   Bump `ANDROID_VERSION` in `src/lib/constants.ts` too - the web download card
   shows that string, while the GitHub Releases link always serves the latest
   build.
2. `npx tsc --noEmit` clean.
3. Test on the emulator when the change is risky (AVD `SureWord_Test`).
4. `bash mobile/scripts/push-phone.sh` - releases to the Play internal track
   and bumps `versionCode`; commit the `app.json` bump together with the
   CHANGELOG entry.
5. Publish the APK to GitHub Releases:
   `bash mobile/scripts/release-apk.sh`
   The script tags `android-v<version>`, attaches the APK under the fixed
   asset name `SureWord.apk`, and re-attaches the other platforms' current
   assets (`SureWord.dmg`, `SureWord.ipa` when it exists). The web app links
   `releases/latest/download/<asset>` and "latest" is a single release, so
   **every release must carry every platform's asset** or the other links
   break. Never rename the assets.
6. Commit `mobile/` changes (the generated `android/` dir stays gitignored).
