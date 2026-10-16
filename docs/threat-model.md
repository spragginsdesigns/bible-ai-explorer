# SureWord threat model

Status: working model, 2026-10-02. Scenarios below are risks to test, not confirmed vulnerabilities. Code inspection alone does not verify deployed Clerk, Stripe, Google Play, Neon, or provider settings.

## Scope and goals

This covers the Next.js web app and APIs, Clerk identity, Neon/Prisma data, AI providers, Stripe and Google Play billing, and native clients that call the same service. Protect private chats, prayers, notes, memories, reading history, attachments, provider API keys, subscription state, and the integrity of Scripture citations and generated guidance.

## Trust boundaries

1. Web and native requests cross into `src/app/api/`. A Clerk session identifies the caller, but each conversation, note, attachment, memory, and billing lookup still needs an ownership check.
2. User messages, attached files, retrieved text, and model output cross into AI tools. These are content, never authorization to read another user's data or change account settings.
3. Server-held provider keys and user BYOK credentials cross from encrypted storage into external model APIs. Minimize outbound private context and keep plaintext keys out of responses, logs, telemetry, and client bundles.
4. Stripe and Google Play notifications cross from external billing systems into local entitlement records. Verify event origin, product mapping, replay handling, and account binding before granting access.
5. Guest flows and share links cross from anonymous or public access into persistent user data. Claim and sharing operations need explicit ownership, scope, and expiry decisions.

## Priority abuse scenarios

| ID | Scenario and impact | Boundary to verify |
| --- | --- | --- |
| SW-1 | A caller supplies another conversation, note, attachment, or memory ID and receives or modifies private content. | Scope every query by the authenticated `userId`; test cross-account reads, writes, regenerate, and attachment reuse. |
| SW-2 | A guest or free user exhausts model spend, bypasses included usage, or claims another guest session. | Verify rate and usage accounting at the server before generation, plus guest claim binding and abuse limits. |
| SW-3 | A prompt injection in a chat or attachment causes a tool to write memory or notes, expose private context, or cite invented Scripture as retrieved fact. | Restrict tool arguments to the current user and distinguish retrieved source text from instructions; require evidence for quoted passages and provenance. |
| SW-4 | A provider key is disclosed through an API response, log, error, telemetry event, or encryption-key loss. | Inspect key write/read paths, encryption-key access and rotation, redaction, and backup/restore behavior. |
| SW-5 | A forged, replayed, or misbound payment event grants or revokes an entitlement incorrectly. | Verify raw-body signature or platform purchase validation, event deduplication, product/account mapping, and reconciliation. |
| SW-6 | A public share or attachment endpoint exposes a private chat, image, or prayer beyond the intended audience. | Review token entropy, scope, revocation, content filtering, cache headers, and object ownership. |

## Evidence and review triggers

The repo `README.md` lists Clerk, Neon/Prisma, AI providers, and native clients. `src/lib/auth.ts` derives the Clerk user; `src/app/api/ask-question/route.ts` shows per-user conversation and attachment queries plus rate and usage paths. `src/app/api/providers/route.ts` stores encrypted provider keys through `src/lib/ai/crypto.ts`. The Stripe and Google Play webhook routes live under `src/app/api/webhooks/`. These are implementation references, not a production-control audit.

Revisit this model for changes to auth, guest claims, sharing, attachments, memory tools, provider routing, billing, push delivery, or data export. Each review should include a second-account negative test and a malformed or replayed external event test where relevant.
