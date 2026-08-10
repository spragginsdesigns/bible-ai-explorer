---
description: Deep-review the current working diff before shipping
argument-hint: [extra context]
---

Run a deep code review of all current working changes before shipping: `git diff` plus every untracked file this session added. Review the actual code, never the plan or memory of it.

Spawn an `explore` subagent (read-only) with `$ARGUMENTS` plus: the user's original request, what was implemented, and the diff scope. Have it read the full diff and the surrounding code for every changed file.

The review verdict is PASS or NEEDS ATTENTION with three mandatory sections:

- **Regression Proof** — the primary gate. For each blast-radius surface (every consumer of a changed hook/component/API contract): behavior before, what it does now, INTACT / CHANGED-AS-INTENDED / BROKEN. A change that breaks something that worked yesterday fails review no matter how well it meets the spec.
- **Spec Trace** — each requirement from the user's request, quoted, with what shipped and what was verified.
- **Devil's Advocate** — at least one real concern, risk, or question. A non-trivial diff with zero concerns means the review wasn't deep.

VerseMind-specific checks:

- **Mission alignment:** anything touching prompts, AI tools, or verse rendering must stay rooted in KJV Scripture per `CLAUDE.md`.
- **Contract drift:** mobile (`mobile/src/lib/api.ts`, feature hooks) vs backend routes (`src/app/api/`) — request/response shapes must match on both sides.
- **Monorepo hygiene:** `mobile/` stays outside the pnpm workspace and the web tsconfig; no new dependencies added silently; `mobile/CHANGELOG.md` + version bump present for user-facing mobile changes.
- **Secrets:** no keys, tokens, device addresses, or `.env` content in the diff.

**Do not ship until this passes.** Any code change made in response to review feedback invalidates prior proof — re-run `/prove-it` on the affected path before shipping.
