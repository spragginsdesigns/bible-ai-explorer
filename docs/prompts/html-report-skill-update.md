# Prompt for another Claude Code session: make every HTML report read like the SureWord review sheet

Paste everything below the line into a fresh Claude Code session started in `C:\Users\Owner\.claude`.

---

Update my global `html-report` skill at `C:\Users\Owner\.claude\skills\html-report\` so every future report reads like the review sheet I approved today, not like a research dossier. Read these two files first, in this order:

1. `C:\Users\Owner\Documents\Github_Repositories\bible-ai-explorer\docs\product-changes-review-2026-09-12.html` (the new bar: simple, scannable, approved)
2. `C:\Users\Owner\Documents\Github_Repositories\bible-ai-explorer\docs\product-opportunity-audit-2026-09-12.html` (too dense; the old bar)

Then make these changes and nothing else:

**1. Replace the reference.** Copy the review sheet to `assets/example.html` (overwrite the old example) and update `SKILL.md` so it names the review sheet as the standard. Keep `assets/template.html` CSS tokens as they are (dark, zinc, one blue-to-cyan accent), but add the review sheet's components to the template: the `.id` pill, the `.naw` Now/After/Why definition list, the `.rel` release heading with a mono tag, and the `.grid>*{min-width:0}` and `code{overflow-wrap:anywhere}` fixes that stop long paths overflowing at 375px.

**2. Rewrite the "Rules" and "Structure" sections of `SKILL.md` around these principles:**
- The page must be understood in one scroll. A reader who stops after the first card knows the answer. Every section exists to help me decide or act, never to show work.
- Default structure: eyebrow, one-line headline that is the answer, a one-paragraph plain-English verdict card, then items. Items are cards with a short ID pill (F1, A2, C3) so I can reply "skip B3", a one-line title, and a Now / After / Why definition list, each one to three sentences. Size and status as small badges on the card. Group cards under stage or category headings that carry a mono tag ("server only · one deploy").
- Numbers only when they change what I do, and then inline in the sentence or in a short table. KPI tiles are opt-in, never default. No charts unless I asked for one.
- Evidence, queries, logs and file:line lists live inside a folded `<details>` at the end of a card or in a "Not doing" table. The open page is the decision; the folded page is the proof.
- Cap: about 30 items per report, at most 5 sections plus "Not doing" and a one-line footer. If it needs more, it is two reports.
- Copy: plain English, verdict first, no jargon without a gloss, no hype, no emoji, no em dashes. Name things by what I recognize in the product, not by code identifiers, and put a code identifier only where I would need to jump there.
- Keep the existing rules that still hold: single file, inline CSS, Geist from Google Fonts only, dark only, responsive to 375px with the scrollWidth check before handing over, kebab-case filename with the date, saved where the repo keeps docs, and published as an artifact when the runtime has the tool.

**3. Add a "When the report is a plan" subsection:** if the report proposes work, every item must be Now / After / Why plus size (XS/S/M/L), and the report ends with a "Not doing" table. If more than one agent or person will do the work, add an owner badge per item and a short "Who takes what" table with file or directory ownership so two agents never edit the same file.

**4. Verify.** Open the new `assets/example.html` in a browser at desktop and 375px, confirm `document.documentElement.scrollWidth <= innerWidth` at both, and confirm the skill still loads (`/html-report` in a test session prints the updated SKILL.md). Do not touch any other skill, CLAUDE.md, or settings file. Tell me the exact paths you changed when done.
