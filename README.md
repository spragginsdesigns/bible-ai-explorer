<p align="center">
  <img src="public/web-app-manifest-512x512.png" alt="VerseMind Logo" width="200" />
</p>

<h1 align="center">VerseMind — Bible AI Explorer</h1>

<p align="center">
  An AI-powered Bible study companion for believers, grounded entirely in the King James Version.
</p>

<p align="center">
  <a href="https://bible-ai-explorer.vercel.app">Live App</a>
</p>

---

## What Is VerseMind?

VerseMind is a web app that helps Christians study the Bible using AI. It answers questions about Scripture, theology, church history, and daily Christian living — always from the perspective of a saved, born-again believer who holds the KJV Bible as the inerrant, infallible Word of God.

Every response is backed by exact KJV verse quotes, not paraphrases.

## Features

- **KJV-Only Scripture** — All verse quotes are word-for-word from the King James Version
- **Vector Search (RAG)** — Queries a vector database of Bible verse embeddings to find the most relevant passages for each question
- **Web Search Integration** — Tavily search provides supplementary context from trusted sources alongside the AI response
- **Conversation History** — Full chat history stored locally so you can continue past studies
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

*VerseMind: Illuminating Scripture through Artificial Intelligence*
