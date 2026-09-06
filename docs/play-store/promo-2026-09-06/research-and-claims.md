# SureWord Play Store promo: research and claims

Prepared 2026-09-06. Android source: **1.50.0, versionCode 49**, commit **68f67f7**. Verified with `git rev-parse --short=7 HEAD` and `mobile/app.json:5,22`. Source pointers below are relative to the repository root at that commit. Source inspection verifies capabilities; the supplied real Android captures establish the particular UI shown.

## Positioning

**A personal Bible study companion, shaped by your reading, questions, notes, and daily walk.** Lead with the connected experience: read Scripture, ask about it, explore the words and people behind it, and return to a daily study that reflects the user's activity. No evidence supports saying SureWord is the only app with AI, citations, original-language tools, notes, or personalized guidance.

## Recommended image copy and evidence

Each image should communicate one benefit and show the real UI that delivers it. The six strongest candidates without personal notes are chat, reader/verse insight, original languages, Daily Cross, the atlas, and reading plans. An additional reader or welcome panel can expand the set.

| Feature | Suggested headline and supporting line | Verified Android/shared implementation |
|---|---|---|
| Bible study chat | **Bring your questions. Open the Word.** / Explore Bible questions with Scripture-grounded answers and cited passages. | `src/lib/ai-tools.ts:223,246,290` supplies Scripture search, exact passages, and cross-references. `src/utils/systemPrompt.ts:27` requires verifiable references and retrieved quotations. `src/app/api/ask-question/route.ts:603,703` incorporates saved memory and church context. |
| Reader and verse insight | **Tap a verse. Go deeper.** / Read an explanation, highlight what matters, and continue in chat. | `mobile/app/(app)/bible/chapter.tsx:613,616,670` exposes Expand with AI, Highlight, and Save to note. `src/utils/systemPrompt.ts:219` defines a short contextual verse explanation. |
| Original languages | **Meet the words behind the Word.** / Explore Hebrew and Greek with Strong's definitions. | `mobile/src/features/bible/OriginalLanguageSection.tsx:85-90,129,158-162` connects word chips to Strong's entries, morphology, and KJV glosses. `docs/FEATURES.md:118-126` identifies WLC Hebrew and Scrivener 1894 Greek. |
| Pick Up Your Cross | **A daily study shaped by your walk.** / A verse, personal application, and passages to explore today. | `mobile/app/(app)/bible/cross.tsx:192,222-289` renders the named feature, why-today explanation, application, study path, reflection question, and chat continuation. `src/lib/ai-tools.ts:733` describes the reading, questions, notes, and memory inputs. |
| Timeline, People & Places | **See Scripture's bigger story.** / Explore the people, places, and events that connect the Bible. | `mobile/app/(app)/bible/timeline.tsx:208,227-250,452-455` renders explorer modes and grouped search. `src/utils/systemPrompt.ts:50` documents cited relationships, family, journeys, and connection tracing, with implemented Android routes under `bible/atlas/`. |
| Reading plans | **Build a rhythm in the Word.** / Choose a reading plan or describe your own study goal. | `mobile/app/(app)/bible/plan.tsx:34-38,348-350,399` implements presets, custom goals, progress, streaks, and automatic credit for chapters read. `src/lib/reading-plan-presets.ts:283-325` defines Gospels in 30 days, Psalms & Proverbs in 31 days, New Testament in 90 days, and the whole Bible in a year. |
| KJV reader, optional separate panel | **Keep Scripture close.** / Read the KJV offline, adjust the type, and highlight your verses. | `mobile/app/(app)/bible/chapter.tsx:72,634` distinguishes bundled KJV from network NKJV and exposes custom highlight colors. `mobile/src/features/bible/kjv.ts:2,108` supplies local KJV text and search. |

Notes are a supported alternative: folders/tags/search (`mobile/app/(app)/notes/index.tsx:78,117,138`), an in-note AI panel (`notes/[id].tsx:191`), and AI-assisted saving/editing/search (`src/lib/ai-tools.ts:586-587,637,663`). Existing notes captures include personal material or QA text; exclude them unless a clean, suitable real example is captured.

## Access and wording limits

- **Listen requires SureWord Pro.** The Android lock panel states that self-service Pro access is not yet available (`mobile/src/features/cross/ListenCard.tsx:492-500`); `src/lib/daily-cross-audio.ts:325` enforces the entitlement. Do not market it as universally available. Any image showing playback should carry a readable Pro qualification.
- Accounts without their own provider key have included house-model access (`src/lib/ai/provider.ts:297-356`). Do not imply an API key is required to start, unlimited use, or free service forever.
- **Offline means KJV reading/search**, not all app features. NKJV loading, AI responses, and original-language retrieval depend on connectivity.
- Describe answers as Scripture-grounded; do not promise error-free AI or guaranteed theological accuracy. Bible text and generated explanations remain distinct.
- Atlas numeric dates use traditional Ussher chronology and are labeled accordingly (`src/utils/systemPrompt.ts:50`); do not call those dates inspired Scripture.
- Personalization depends on the study context the account has accumulated. Do not suggest SureWord knows unshared life details.

## Comparison research

These are first-party descriptions, checked on 2026-09-06. They establish overlap, not a complete competitive audit or proof that a competitor lacks a feature.

- [YouVersion Bible App](https://www.youversion.com/bible-app) promotes Bible reading and audio, offline access, versions, highlights, notes, plans, and daily habits. Reading and habit tools are established category expectations.
- [Logos mobile Study Assistant](https://support.logos.com/hc/en-us/articles/40263191750285-Enhance-your-Study-Experience-with-Study-Assistant) supports passage-context Explain/Ask actions, conversational follow-ups, and linked source citations. AI plus citations is not exclusive to SureWord.
- [Bible Chat](https://thebiblechat.com/) advertises biblical questions with references, audio Bible translations, study plans, verse finding, quizzes, and character studies. Do not claim competitors offer only generic chat or lack study context.
- [Hallow categories](https://hallow.com/categories/) presents Christian/Catholic prayer, meditation, Bible, and sleep content. Prayer and reflection audio is a crowded benefit; SureWord's connected Scripture-study workflow is the stronger emphasis for this set.

The proposed direction is an editorial inference from this overlap and SureWord's verified implementation: show the actual progression from verse to explanation to original language, related history, and daily study. Avoid competitor logos, rankings, superiority claims, or copied taglines.

## Brand and production brief

- Native colors: black **#000000**, amber gold **#fbbf24** (`mobile/src/theme/index.ts:15,37`). Use warm white body text and restrained gold emphasis over black.
- Typography: **Pirata One** for the SureWord brand; **Cormorant Garamond** for Scripture; **Atkinson Hyperlegible** for readable UI/body text (`mobile/src/theme/index.ts:106-116`). Keep promotional headlines short and legible at thumbnail size.
- Preserve authentic screenshot text and geometry. Use clear framing, one dominant real screen per panel, and sufficient screen scale to read the evidence. Avoid loading states, keyboards, personal details, QA text, and decorative elements that compete with the app.
- Existing raw capture provenance is in `artifacts/android-experience-2026-09-06/capture.ps1`: Android emulator `screencap` PNGs paired with UIAutomator XML. Treat newly captured sources in this promo directory as the final composition inputs; no invented app screens.
- Export phone panels as **1080 x 1920**, opaque RGB PNGs (24-bit, no alpha), or JPEGs. Google allows up to eight screenshots per device type and recommends at least four 9:16 portrait app screenshots at this resolution for screenshot-based recommendations. Show authentic in-app experience; prioritize the UI in the first three, avoid stretched screens, and clean excess notification-bar elements. These are distinct from the lower minimum requirements for simply publishing a listing. [Google Play preview-asset guidance](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en-GB)

This document records creation guidance and source evidence. It does not claim that the images have been uploaded to Play Console or approved by Google.
