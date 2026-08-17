# SureWord for Android

The native Android app for **SureWord** — a KJV Bible study companion that
answers from a believing perspective, quotes Scripture word-for-word, writes
into your study notes on request, and remembers you between conversations.

**This is the primary SureWord client and the source of truth for
features.** New features land here first — and the web app
(bible-ai-explorer.vercel.app) MUST be brought to 1:1 feature parity in the
same release cycle. Web may be a superset, never a subset. The parity rule
lives in `CLAUDE.md`; the feature-by-feature tracker is `docs/PARITY.md` —
update it on every feature release. The web app links to this app's APK
(Drive file below) so web users can install it.

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
└── scripts/push-phone.sh   # build + wireless-ADB install to the S24 Ultra
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
- Release builds sign with the debug keystore — fine for sideloading.

### Pushing to the phone

```bash
bash mobile/scripts/push-phone.sh              # build + install + launch over Wi-Fi
bash mobile/scripts/push-phone.sh --skip-build # reuse the last APK
```

One-time pairing and recovery steps are printed by the script (and documented
in `.claude/skills/push-phone/SKILL.md`). Wireless-debug ports rotate; the
script self-heals by port-scanning the phone's last-known IP.

## Release checklist

1. Bump `version` in `app.json` and add a `CHANGELOG.md` entry.
2. `npx tsc --noEmit` clean.
3. Test on the emulator when the change is risky (AVD `SureWord_Test`).
4. `bash mobile/scripts/push-phone.sh` to Austin's phone.
5. Update the Drive APK in place (same file id, keeps the share link):
   `gws drive files update --params '{"fileId":"1BvfwTE7Na5pAIbwY8VG6Yvkp6vxJpqKu"}' --json '{"name":"SureWord-<version>.apk"}' --upload <apk> --upload-content-type application/vnd.android.package-archive`
6. Commit `mobile/` changes (the generated `android/` dir stays gitignored).
