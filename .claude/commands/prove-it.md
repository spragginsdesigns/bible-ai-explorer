---
description: Prove the change works through the real product path with adversarial testing
argument-hint: <claim to prove>
---

Prove the change through the real product path. A `FAILED` result that catches a real bug is worth more than a `Proven` result that missed one — fail honestly, never rubber-stamp your own work.

**Verification is a loop, not a checkpoint.** Typecheck and tests green is where this *starts*. Exercise the real path, attack it, and when the attack breaks something, fix it and run the path again — every code change after a pass re-invalidates that pass. You are proven when a full adversarial pass surfaces nothing new. **Narrate the evidence chain as you go**, one line per step (action → observed result → what it means).

**Claim to prove:** $ARGUMENTS

## Resolve the claim

If `$ARGUMENTS` is a specific claim, use it. If empty, build it from the conversation: state in one plain sentence what a real user should now experience differently. Multiple criteria are multiple claims; prove every one.

## Proof Card

Before running any tools, write the proof target in plain English:

- **Expected change:** what should a real user now be able to do?
- **Real path:** where will you prove it — exact screen, route, API endpoint, or flow?
- **Pass signal:** what exact observation counts as proof — visible UI state, response body, log line, screenshot?
- **No-regression check:** what nearby unaffected path must still behave the same?
- **Root cause confirmed (bugs only):** can you reproduce the original symptom through the original repro *before* the fix, and does reverting the fix bring it back? If the symptom will not reproduce without your change, you fixed a red herring.
- **Attack:** what is the most likely edge case or failure mode that would disprove the change?

If you cannot fill this out with concrete values, stop and reread the request and the changed code path.

## Proof Depth

| Tier | Use for | Required proof |
|---|---|---|
| **Tiny** | copy, labels, one-surface visual tweaks | Static gates + one screenshot on device, one nearby regression check |
| **Normal** | most mobile UI / API behavior changes | Proof Card, exact input/output, raw artifact, one attack, support checks |
| **High-risk** | auth, persistence, streaming, notes editor, shared components | All of Normal plus positive + negative controls and a no-regression pass per consumer |

## Rules

1. **Real product path first.** Typecheck, unit tests, lint, "logic looks correct" — support checks, never proof. Report them under `Support Checks`, but the only answer to "does it work?" is observed behavior on the real path.
2. **Verify adversarially.** You wrote the code and want it to work, which makes you the worst verifier. Act as a QA engineer trying to break it. A clean first pass usually means you only tested the happy path.
3. **Any code change after proof invalidates the proof** — re-verify the affected path.
4. **Capture at least one raw artifact**: device screenshot, copied response body, or test/log output.
5. **Match certainty to evidence.** "Proven" means you saw the exact output. "Looks correct" means you guessed.
6. **User-facing AI output needs product-quality proof.** VerseMind's answers must be rooted in KJV Scripture per the mission in `CLAUDE.md`. If the change touches prompts, tools, or retrieval, run 2-3 real questions through the real chat path and judge the answers: KJV-grounded, no watering down, citations render correctly. Generic or off-mission output means `Incomplete` or `Failed`, not Done.

## Required proof by change type

| Change type | Required proof |
|---|---|
| Mobile UI / behavior | Release APK on Austin's phone via `bash mobile/scripts/push-phone.sh`, relaunch, exercise the changed screen, `adb exec-out screencap -p` screenshot (see Mobile device gate below) |
| Backend API route | Real request through the route (local `pnpm dev` or https://bible-ai-explorer.vercel.app) with a real auth token, response body captured — read the body, not the status |
| Streaming endpoint | Observe the streamed chunks arrive (not just a 200), plus a stalled-connection/timeout case |
| Notes persistence | Create/edit, force-close or navigate away, reopen — content survived |
| KJV/bible data | Verse-count/spot-check validation (Genesis 1:1, John 3:16, Revelation 22:21) against a known-good source |

## Mobile device gate

For any mobile code, Gradle, manifest, or asset change:

1. `bash mobile/scripts/push-phone.sh` — builds the arm64 release APK, discovers the phone (wireless ADB or USB), installs, launches. Exit code 2 = no phone reachable.
2. Exercise the changed path on-device; capture a screenshot (`adb exec-out screencap -p > shot.png`) and inspect it visually.
3. Check `adb logcat -d -b crash` for new crashes.

If no phone is reachable (exit 2): run the static gates (`cd mobile && npm run typecheck && npm test`), state plainly that the device gate could not run and the change is verified by types/tests only, and continue — in this repo that is a reported gap, not a hard stop, unless the change is High-risk tier (auth/persistence/streaming), in which case stop at `Incomplete - Awaiting Real Trigger` and tell Austin to run `/push-phone`.

## Support Checks (always run, never sufficient alone)

```bash
cd mobile && npm run typecheck && npm test   # mobile changes
pnpm lint                                     # web/backend changes
pnpm build                                    # backend contract changes (catches what lint misses)
```

## Attack it (mandatory)

After the happy path works, execute the Attack from your Proof Card, then at least one more that applies: empty/null data, boundary values, rapid double-fire, offline/airplane mode, the sibling feature you did NOT change, long lists (Psalm 119's 176 verses), stale state after navigate-away-and-back. Soft attempts (the same happy path with slightly different data) do not count. Report what you tried and what happened. If something breaks, fix it or report it; never silently move on.

## End states

### `Proven`

Valid only with: one real success case, one attack that failed to break it, at least one raw artifact — and for auth/persistence, a positive AND negative control.

```markdown
## Proven
- **Expected change proven:** [plain-English behavior]
- **Environment:** [branch, commit, device / localhost / production]
- **Real path used:** [screen / API route / flow]
- **Observed result:** [exact visible result / response / log line]
- **Negative control:** [what should NOT happen, confirmed it doesn't — or N/A]
- **No-regression check:** [nearby unaffected paths verified]
- **Attack attempts:** [what you tried to break and what happened]
- **Artifact:** [screenshot / response body / test output]
- **Support checks:** [typecheck, tests, lint, build]
- **Ready to ship:** Yes
```

### `Incomplete - Awaiting Real Trigger`

Support checks passed but the real path was not exercised (e.g. no phone reachable on a High-risk change). Report: what was verified, what is still unproven, the exact missing trigger, and **Ready to ship: No**.

### `Failed - Change Does Not Work`

The evidence shows the change is broken. Report: expected vs actual, artifact, likely cause, and **Ready to ship: No**. This is a valid and valuable outcome — catching it before production is the whole point.
