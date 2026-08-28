<p align="center">
  <img src="public/web-app-manifest-512x512.png" alt="SureWord Logo" width="200" />
</p>

<h1 align="center">SureWord</h1>

<p align="center">
  An AI-powered Bible study companion for believers, grounded first in the King James Version.
</p>

<p align="center">
  <a href="https://sureword.app">Open SureWord on the web</a> ·
  <a href="https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest/download/SureWord.apk">Download Android</a> ·
  <a href="https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest/download/SureWord.dmg">Download macOS</a>
</p>

SureWord uses the KJV by default. NKJV is available as a selectable reader and
answer translation. The web app, Android app, and native Apple clients use the
same authenticated backend, so conversations, notes, memories, reading history,
and the daily walk follow the account.

## Clients and parity

- **Android** (`mobile/`, Expo / React Native) is the primary client and first
  acceptance target. The current checked-in version is **1.38.0 (versionCode 35)**.
- **Web** (`src/`, Next.js) runs at [sureword.app](https://sureword.app).
- **macOS** (`macos/SureWord/`, SwiftUI) is the native desktop client; the current
  project version is **1.6.0**.
- **iOS** (`macos/SureWord-iOS/`, SwiftUI) shares the Apple core. Its source and
  simulator target are checked in, but it is not yet distributed.

The parity rule is capability parity with platform-native layouts. Android leads;
web, macOS, and iOS follow in the same release cycle. See the living
[parity tracker](docs/PARITY.md) for verified, partial, and not-yet-distributed
capabilities.

## Core features

- KJV-first Bible reader with NKJV selection, offline KJV text, search,
  quick-jump, adjustable type, verse actions, and synced highlights
- Tap-a-verse explanations and full streaming Bible study chat
- Exact Scripture retrieval with Neon pgvector plus keyword fallback, curated
  cross-references, and grounded Hebrew/Greek and Strong's tools
- Private multimodal questions with image, PDF, and text-file attachments
- Durable conversations, rich-text notes, folders, tags, semantic note search,
  and user-controlled memories
- **Pick Up Your Cross**: a personalized daily guide with provenance, exact-verse
  and recent-theme safeguards, and a study path that can follow a reading plan
- **Listen**: a Pro spoken devotional with transcript, playback speed, and
  background playback where the client supports it
- Reading plans with four presets, custom goals, progress from Bible reading,
  streaks, and archive/replace controls
- **Timeline, People & Places**: a KJV-grounded Bible atlas spanning Creation to
  Revelation, with journeys, relationships, and cited connections
- **My church**: choose a home church from Google Places and use its saved profile
  as relevant chat context

## Technology

| Layer | Technology |
|---|---|
| Web/API | Next.js 15.5.21 (App Router), TypeScript |
| AI | Vercel AI SDK 7 with OpenAI, Anthropic, and Moonshot providers |
| Data | Neon Postgres via Prisma, including pgvector embeddings |
| Auth | Clerk |
| Search | Tavily for optional supplementary web results |
| Web UI | Tailwind CSS + Radix-based components |
| Native clients | Expo SDK 57 / React Native; SwiftUI for macOS 15+ and iOS 26+ |

## Getting started

### Prerequisites

- Node.js 18.18 or newer (this checkout was checked with Node v24.18.0)
- pnpm (this checkout was checked with pnpm v11.17.0)

### Web/API setup

```bash
git clone https://github.com/spragginsdesigns/bible-ai-explorer.git
cd bible-ai-explorer
pnpm install
```

Create `.env.local` using your own securely managed values. Never commit this
file or paste credentials into issues, chat, or logs.

```dotenv
# Required for local web/API development
DATABASE_URL=
DATABASE_URL_UNPOOLED=
OPENAI_API_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Optional integrations and provider access
CREDENTIAL_ENCRYPTION_KEY=
TAVILY_API_KEY=
ANTHROPIC_API_KEY=
MOONSHOT_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
GOOGLE_PLACES_API_KEY=
PRO_USER_IDS=
SERVER_CREDENTIAL_USER_IDS=
CRON_SECRET=
```

Neon integration values are injected automatically in the linked Vercel
project. Local values must point at the intended application database.

Run the web app and the logic suite:

```bash
pnpm dev
pnpm test:logic
```

For a production-style check, use `pnpm build`. The native clients are separate
projects and are not part of the root pnpm workspace.

### Native clients

Android development and release instructions are in [`mobile/README.md`](mobile/README.md).
The Android release path is run from Git Bash with
`bash mobile/scripts/push-phone.sh`; it publishes the Play internal build and
matching `SureWord.apk` to GitHub Releases.

macOS and iOS require Xcode on a Mac. Build and test instructions are in
[`macos/README.md`](macos/README.md); `macos/project.yml` is the source of truth
for the generated Xcode project.

## Documentation map

- [`docs/FEATURES.md`](docs/FEATURES.md) — architecture notes for non-obvious
  product features
- [`docs/PARITY.md`](docs/PARITY.md) — per-client capability and verification status
- [`docs/PLAY_STORE.md`](docs/PLAY_STORE.md) — Android Play release procedure
- [`mobile/README.md`](mobile/README.md) — Android build and release workflow
- [`macos/README.md`](macos/README.md) — Apple build, install, and test workflow
- [`src/data/bible-atlas/README.md`](src/data/bible-atlas/README.md) — atlas data
  authoring and validation
- [`docs/NextJS_to_Expo_Migration_Plan.md`](docs/NextJS_to_Expo_Migration_Plan.md) —
  historical migration record; not current architecture guidance
- [`design-qa.md`](design-qa.md) — historical UI QA evidence and its verification
  boundaries

*SureWord: Illuminating Scripture through Artificial Intelligence*
