# Planned Features

Product ideas that are worth preserving but are not part of the current
implementation. An item moves out of this file only when its product contract,
entitlements, data model and acceptance path are settled.

## Quiz me (a short quiz after a study)

**Status:** Planned 2026-10-25. Full plan and mockups: [quiz/PLAN.md](quiz/PLAN.md).

## Walk with me (guided first run, led by SureWord)

**Status:** Planned 2026-10-25. Full plan: [onboarding/PLAN.md](onboarding/PLAN.md).

## Pro built-in AI identity

**Status:** Pinned for product design

SureWord Pro users should not need to bring an API key. Pro uses SureWord's
app-managed OpenAI access, while bring-your-own-key remains an optional path for
people who explicitly want to use their own provider account.

The UI should present the built-in option as a SureWord product capability, not
as though the user configured an OpenAI key. The final name is intentionally
unsettled; possible directions include **SureWord Pro AI** or **SureWord AI**.

Before implementation, decide:

- how the built-in option is labelled in the model/provider picker;
- whether the underlying model name is visible as secondary technical detail;
- how Pro entitlement, fair-use limits and provider outages are explained;
- whether a user's BYOK selection overrides the built-in option globally or
  only for chat;
- which background features always use the app-managed model so scheduled work
  does not depend on a short-lived or revoked personal credential;
- how free users experience features that require app-managed inference.

Non-negotiable: no UI or API response may expose the app-managed credential.

## Longitudinal daily-walk controls

**Status:** Shipped 2026-09-16 as "Stay with this" / "Take me somewhere fresh"
(contract in `FEATURES.md` → "Stay with this, or take me somewhere fresh");
the "helpful / too repetitive" feedback bullet below is still open and belongs
to the answer-feedback contract. The precondition was met once the stored day
carried `primaryThemeKey`, `selectionEvidence` and message origin.

**Original status:** Explore after selection provenance has real usage data

Pick Up Your Cross should eventually let a person signal whether they want to
continue a developing theme or receive a fresh direction. Candidate controls:

- **Stay with this** — make continuity explicit and advance to a materially new
  angle rather than repeating yesterday's application;
- **Take me somewhere fresh** — strengthen the recent-theme novelty penalty;
- lightweight “helpful” / “too repetitive” feedback for evaluation and future
  personalization.

Do not build these controls until stored theme, evidence and message-origin data
can support them honestly.

---

## Five-Phase Product Roadmap (2026-10-14)

Approved for phased delivery across shared backend, Android (`mobile/`), Web (`src/`), and Apple (`macos/`):

### Phase 1 — Speed + True "Study Bible" Loop (In Progress)
1. **Chat TTFT Parallelization (`src/app/api/ask-question/route.ts`):** Run `resolveModel` and `actionDecisionBlock` concurrently inside the pre-stream `Promise.all` alongside `loadUserMemories`, `loadUserChurch`, `loadChatDayContext`, `loadHighlightLegend`, and profile sync.
2. **Reader & Verse Sheet Prefetching:**
   - Prefetch adjacent chapters (`neighbors.prev` and `neighbors.next`) in the background once the active chapter settles.
   - Cache and prefetch `See also` cross-references (`GET /api/bible/crossrefs`) per session (`translation:reference`) as soon as a verse selection settles, eliminating tab-switch re-fetches and loading states.
3. **Android BSB "Continue reading" Parity Fix:** Accept `"BSB"` alongside `"KJV"` and `"NKJV"` in `parseLastRead` on Android (`mobile/app/(app)/bible/index.tsx`), matching Web.
4. **Reader Note Picker + "Notes" in the Verse Sheet ("Study Bible" Loop):**
   - Tapping **Note** in the Bible reader's Verse Sheet opens the Note Picker (`AddToNoteSheet` / `AddToNoteDialog` with `compose: false`) so verses can be appended to an existing study note or saved as a new note without leaving the chapter.
   - Pure chapter-note matcher (`chapterNotes.ts` / `ChapterNotes.swift`) links the user's saved notes to the verses and chapters they reference, showing inline verse note indicators in the chapter reader and a **Notes** tab (`Explain` | `Words` | `See also` | `Notes`) in the Verse Sheet.

### Phase 2 — Pick Up Your Cross 2.0 + Persistent `Listen` Mini-Player
1. **Answer "Carry This" on the Daily Cross screen:** Save a personal reflection or prayer on today's question (`VerseOfDay.reflection` / `answeredAt`), optionally mirrored to a running journal note.
2. **Daily Cross History Scrubber:** Browse past `VerseOfDay` entries (`Today · Yesterday · ...`) to revisit previous verses, why they were chosen, spoken devotionals, and personal reflections.
3. **Persistent `Listen` Mini-Player:** Keep the spoken devotional playing in a floating mini-player bar when navigating from Pick Up Your Cross into the Bible chapters of Today's Study.

### Phase 3 — Bible Hub "Today's Walk" Bento + Highlights Gallery
1. **Bible Hub "Today's Walk" Bento:** Replace the 6 stacked gray rows at the top of the Bible tab with a prioritized "Today's Walk" hero pair (Pick Up Your Cross + Continue Reading / Plan) and a 2×2 study bento grid (`Learn`, `Plan`, `Timeline & People`, `Reading Log` / `Sermons`).
2. **Highlights Gallery by Label:** Browse and filter all highlighted verses across the Bible by the user's custom color labels (*Promises*, *Commands*, *Warnings*, etc.), with one-tap jump to chapter or add to Learn.

### Phase 4 — The Prayer Closet & *Ebenezer* Answered Prayer Wall
1. **Dedicated Prayer Closet Screen:** Elevate prayer requests out of `Settings → Memory` into a dedicated Prayer Closet surface with KJV promises paired to each open request.
2. **"Pray Through My List" Mode & Ebenezer Wall (1 Samuel 7:12):** Guided distraction-free prayer cards and a permanent hall of answered prayers with dates and praise notes.

### Phase 5 — Sacred Verse Art Cards, Animations & Book Headers
1. **1-Tap Shareable Sacred Verse Art Cards:** Render shareable verse images in Sanctuary Dark/Gold, Aged Parchment, and Olive Dawn styles (1:1 Square and 9:16 Story/Wallpaper).
2. **Sacred Micro-Animations & Book Headers:** Smooth pose crossfades and radial gold halo on `SureWordGuideAvatar`, tactile reader chapter transitions + haptics, and Chapter 1 book introduction headers.
