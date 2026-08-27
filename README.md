<p align="center">
  <img src="public/web-app-manifest-512x512.png" alt="SureWord Logo" width="200" />
</p>

<h1 align="center">SureWord</h1>

<p align="center">
  An AI-powered Bible study companion for believers, grounded entirely in the King James Version.
</p>

<p align="center">
  <a href="https://sureword.app">Live Web App</a> ·
  <a href="https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest/download/SureWord.apk">Download the Android App (APK)</a>
</p>

---

## Clients & the Parity Rule

SureWord has four clients over one shared backend (this repo's Next.js API routes + Postgres):

- **Android** (`mobile/`, Expo / React Native) — the **primary client, source of truth and first acceptance target**
- **Web** (`src/`, Next.js) — the immediate parity surface and fallback test path
- **macOS** (`macos/SureWord/`, SwiftUI) — native desktop parity
- **iOS** (`macos/SureWord-iOS/`, SwiftUI) — native mobile parity

**Parity rule:** build and exercise Android first. Web, macOS and iOS must receive the same capability in the same release cycle; layout may adapt to the platform, but behavior may not be dropped. When Android cannot run, web can provide temporary proof, but Android remains the release gate. The living tracker is [`docs/PARITY.md`](docs/PARITY.md); project rules are in [`CLAUDE.md`](CLAUDE.md).

The Android AAB goes to Play internal testing and its matching APK goes to GitHub Releases in one release command. The site discovers current Android and macOS versions independently instead of relying on hardcoded labels: **[Download SureWord for Android](https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest/download/SureWord.apk)**.

---

## What Is SureWord?

SureWord is a Bible study assistant that helps Christians study the Bible using AI. It answers questions about Scripture, theology, church history, and daily Christian living — always from the perspective of a saved, born-again believer who holds the KJV Bible as the inerrant, infallible Word of God.

Every response is backed by exact KJV verse quotes, not paraphrases.

## Features

- **KJV-Only Scripture** — All verse quotes are word-for-word from the King James Version
- **Tap-a-verse** — Tap any verse in the Bible reader for an instant streaming AI explanation of what it says in context and why it matters, generated with your selected model; one tap more expands the verse into a full chat study ([details](docs/FEATURES.md#tap-a-verse))
- **Vector Search (RAG)** — Queries a vector database of Bible verse embeddings to find the most relevant passages for each question
- **Web Search Integration** — Tavily search provides supplementary context from trusted sources alongside the AI response
- **Private Multimodal Chat** — Ask from screenshots, photos, PDFs, and text-based study files on Android or web
- **Conversation History** — Durable chat and attachment history so you can continue past studies
- **Follow-Up Questions** — Suggested questions for deeper study after each response
- **Verse Attribution** — Clickable references and confidence indicators for retrieved passages
- **Dark / Light Mode** — Comfortable viewing in any environment
- **PWA Support** — Installable on mobile devices for an app-like experience

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS + Shadcn/Radix UI |
| AI | OpenAI GPT-4o via LangChain |
| Embeddings | OpenAI text-embedding-3-large |
| Vector DB | DataStax AstraDB |
| Web Search | Tavily API |
| Hosting | Vercel (auto-deploy on push to `main`) |

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm

### Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/spragginsdesigns/bible-ai-explorer.git
   cd bible-ai-explorer
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Create `.env.local` with the required keys:
   ```
   OPENAI_API_KEY=
   ASTRA_DB_APPLICATION_TOKEN=
   ASTRA_DB_API_ENDPOINT=
   ASTRA_DB_COLLECTION=
   TAVILY_API_KEY=
   ```

4. Start the dev server:
   ```bash
   pnpm dev
   ```

### Deployment

Push to `main` and Vercel handles the rest. Make sure the same environment variables from `.env.local` are configured in your Vercel project under **Settings > Environment Variables**.

---

*SureWord: Illuminating Scripture through Artificial Intelligence*
