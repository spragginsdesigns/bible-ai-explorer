---
description: Run the standard VerseMind task workflow end-to-end
argument-hint: <task description>
---

# Start Workflow

Work `$ARGUMENTS` using `CLAUDE.md`. The Android app (`mobile/`) is the primary client; the web UI is maintenance-only; the Next.js backend is shared and fully active. Every step applies regardless of output mode.

## 1. Triage (always first)

1. Read the request fully. If the user attached a screenshot, **view it before anything else** — a screenshot frequently shows the exact bug or layout and skipping it is the #1 way to misread scope. If an image fails to load, say so and ask rather than guess.
2. Restate the ask in one plain sentence, including which client(s) it touches (mobile / backend / web).
3. Check `mobile/CHANGELOG.md` and recent `git log` for in-flight or related work.

## 2. Investigate like a real engineer

Do not write code until you understand what is actually happening and why. **Narrate as you go** — after each batch of reads, one line: what you found, what it means, what you check next.

- **Code** — target files, callers, imports, siblings. Mobile feature layout: `mobile/src/features/<feature>/`, screens in `mobile/app/(app)/`, shared primitives in `mobile/src/components/ui.tsx` + `mobile/src/theme/index.ts`.
- **Git history** — `git log` / `git blame` on suspect files. For any "used to work" regression, check this BEFORE theorizing: most bugs trace to a recent commit.
- **Backend** — the API routes in `src/app/api/` serve both clients; read the route before changing a client contract.
- **Runtime** — reproduce before diagnosing. For mobile, the real path is the app on Austin's phone (`/push-phone`); for backend, a real request against the route (local `pnpm dev` or the deployed Vercel URL).

Say `confirmed` only for what you personally verified; otherwise it's a hypothesis. If the symptom cannot be reproduced or the cause cannot be verified, the investigation is still open — report the exact missing evidence.

**Parallelize only when scale earns it.** Default: investigate yourself, fix solo. Fan out read-only scouts only when the surface is genuinely large (multi-feature, competing hypotheses), each with a tight question and a required report (finding + evidence + confidence). Never spawn a scout for what one Grep would answer.

## 3. Design gate (features/enhancements only)

Skip for bugs, chores, and single-file fixes. Activate when the work is a feature touching 3+ files or introducing new behavior. Before coding, present:

- **2-3 options**, each with a one-sentence summary, effort (small/medium/large), main risk, and what existing code it builds on. Always include one minimal option.
- **Attack the recommended option first.** What would make it fail? What assumption is it built on?
- **Validate:** every external dependency (API key, new npm package, env var) listed upfront — do not add dependencies silently; rollback path named.
- **No placeholders in an approved plan.** TBD, TODO, "implement later" are banned.
- State as: **Building** / **Not building** / **Approach** / **Key decisions**.

Post the design, then continue without waiting for approval — the standing authorization in `CLAUDE.md` → Autonomous Workflow covers implementation and shipping after green gates. Stop only when two unresolved product interpretations would create different user-visible behavior; ask one specific question, then resume from the reply.

## 4. Implement

Smallest, safest correct change at the correct layer, per `CLAUDE.md`. Investigation depth must not inflate implementation size — if the answer is 5 lines, write 5 lines. Match the surrounding file's style (tabs, theme tokens, existing primitives). Add Vitest coverage when the project already tests that area (`mobile/src/features/**`, `mobile/src/lib/**`).

**Mobile release housekeeping:** any user-facing mobile change gets a `mobile/CHANGELOG.md` entry and a version bump in `mobile/app.json` + `mobile/package.json` (kept in sync).

## 5. Prove it

Run `/prove-it`. If verification fails, fix it and verify again; done means proven.

## 6. Review (expect it to find something)

Run `/review-code` over the actual working diff (`git diff` + untracked files), not from memory. A review that finds nothing on a non-trivial change usually means you reviewed the plan, not the code. When it finds a real defect, fix it, then re-run `/prove-it` on the affected path. Any code change after proof kills the proof. Loop until the reviewed diff is the proven diff and a clean pass surfaces nothing new.

## 7. Ship on green gates

Once `/prove-it` and `/review-code` are both green on the final diff, hand off to `/ship-it` — no approval wait (`CLAUDE.md` → Autonomous Workflow).
