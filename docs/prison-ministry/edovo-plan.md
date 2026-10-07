# SureWord on prison tablets: the Edovo plan

Researched 2026-10-07. Every claim below links to its source; anything not confirmed by a source is marked **unverified**.

## The short version

California (CDCR) does not take content directly. A provider applies to **Edovo**, the platform CDCR approved for incarcerated-person tablets, and Edovo screens, formats and publishes it. There is no live AI on the tablets, so what SureWord can offer is static course content: the kit in [`kit/`](kit/), built by `scripts/export-edovo-course.mjs` from the app's own "The Gospels in 30 days" reading plan.

## The CDCR to Edovo path

CDCR's page for [Program Providers Seeking to Distribute Digital Content](https://www.cdcr.ca.gov/community-partners/program-providers-seeking-to-distribute-digital-content/) (updated March 20, 2026, "effective immediately") says:

- "Edovo is a digital platform approved by CDCR to deliver educational and program content on incarcerated person tablets."
- Providers go to the [Edovo Content Partners](https://www.edovo.org/who-we-serve/content-partners) site, complete the content partner application, and then work with an assigned Edovo account manager.
- Acceptable material is "educational, rehabilitative and program related content that meets CDCR policy and Edovo content standards."
- "Content is reviewed through Edovo's screening process, aligned with CDCR policy. CDCR may review content if issues arise."
- Publishing fees are quoted by the Edovo account manager.

Edovo's own process ([content partners page](https://www.edovo.org/who-we-serve/content-partners)): apply, introductory call, sign a contract and receive Edovo Editor credentials, then publication in about 30 days. Edovo reports reaching over 1.1 million incarcerated learners in 1,500+ facilities.

**Application form:** <https://forms.gle/5NJpTQPfDaQJPS998> (linked from the content partners page).

## Fees

Edovo charges a one-time, up-front publishing fee per tier, with a year to use the tier's item allowance and no recurring fee. One "item" is one distinct piece of content: a course, a podcast, a video, a book. Each is counted separately. The fee covers screening, compliance review, formatting, tablet adaptation, metadata and QA. **Dollar amounts are not published**; ask the account manager. ([Content partner pricing](https://www.edovo.org/who-we-serve/content-partner-pricing))

## Screening rules

From [Edovo content screening (what's not allowed)](https://support.edovo.com/portal/en/kb/articles/edovo-content-screening-aka-what-s-not-allowed-23-6-2025):

- **You must own the content or have written permission** from the copyright holder. "Attribution doesn't replace permission."
- It must fit an approved category. **"Spiritual content" is one of them**, alongside Recovery, Reentry, Family and Relationships, Emotional Wellness and others. It must "educate, equip, inspire, or support personal growth", not purely entertain.
- Not allowed: violence (including content that "describes, or encourages violence to self or others"), graphic violence or gore, gang promotion, weapons, escape or security bypass, contraband, drug or alcohol making, tattooing, gambling, sexual content, self-harm methods, hate speech or attacks on protected groups, false legal or medical advice, personal messages to incarcerated people, and **"marketing of any kind."**
- Screening, evaluation and publishing "may take up to 30 business days."

What this means for the kit: the lessons carry no app name, website, or call to download SureWord; the crucifixion is stated plainly, not graphically; Judas's death is not described. The course's rights statement names SureWord as owner (that is permission, not marketing), but Edovo may ask for even that line to be removed.

## Formats and what tablets can run

Edovo supports four content types ([How does the Edovo platform work?](https://support.edovo.com/portal/en/kb/articles/how-does-the-edovo-platform-work)):

| Type | What it is | Certificate? |
|---|---|---|
| Course | "full, scaffolded learning journeys with interactive elements and multimedia" | **Yes, the only type that earns one** |
| Interactive resource | "short videos + reflection questions or quick knowledge checks" | No |
| Stand-alone item | "One video, PDF, or audio with no questions" | No |
| Learning path | Edovo-curated playlist | No |

"Everything you publish appears in the learner's transcript, even a single PDF" (same article). Courses are built by the partner in the **Edovo Editor** ([Step 1 guide](https://support.edovo.com/portal/en/kb/content-creators-and-partners/build-review-and-publish-active-learning-content-aka-courses-interactive-resources-surveys/step-1-how-to-build-active-content-in-the-edovo-editor-courses-and-interactive-resources)); Edovo also offers to help upload or convert hard-copy material. File guidance from that guide: images up to about 2 MB, PDFs 5 to 10 MB with real text rather than scanned images, and video compressed before upload for prison networks.

What tablets cannot do: there is no open internet and no live chat, so the SureWord app, its AI answers, and its links do not work there. Only content Edovo has published runs. (The no-internet point is from CDCR/Edovo materials describing "the absence of wireless access" in facilities, page 2 of the BPH deck below; tablet-level network details are **unverified**.)

Course length guidance ([Size matters: ideal course length](https://support.edovo.com/portal/en/kb/articles/size-matters-the-ideal-course-length-guide)): 1 hour for one skill, 11 to 20 hours for "true behavior change", with assessment checkpoints every 1 to 2 hours. Reading all four Gospels is well over 10 hours, so the 30-day course sits in the long band.

## Why course completion can matter at parole

The CDCR Board of Parole Hearings hosts [Evaluating Digital Learning Accomplishments for Use in Parole Decisions](https://www.cdcr.ca.gov/bph/wp-content/uploads/sites/161/2025/10/pv-5.-Evaluating-Digital-Learning-Accomplishments-for-Use-in-Parole-Decisions.pdf) (October 2025 upload). It is an **Edovo-authored presentation** to the Board, not a BPH policy, so it shows how Edovo pitches the transcript, not a rule the Board must follow. What it says:

- The Edovo transcript lists every course and resource, hours spent, completions and scores, and is "tangible proof of dedication to personal growth and rehabilitation."
- Because most Edovo programming is optional, using it "demonstrates a genuine desire to change", and patterns across courses can show a narrative.
- The learner shares a nine-digit code from their profile; an attorney, family member or the Board views the transcript at edovo.org/transcripts.
- It suggests hearing questions such as "What was the most significant thing you learned, and how has it changed your perspective?"

Whether a given panel weighs a faith course, and how much, is **unverified**. Do not promise parole benefit anywhere in the course or the application.

## Precedent for faith content

- Amazing Facts International put Bible content on Edovo, and its Introductory Bible Course (the first 14 Amazing Facts Study Guides) was accredited as a course on the platform ([Amazing Facts announcement](https://www.amazingfacts.org/?p=195411)).
- Prison Fellowship and Our Daily Bread Ministries appear among Edovo content partners in the BPH deck (page 5).

## The kit

| File | Purpose |
|---|---|
| `kit/gospels-30-days.md` | The whole course: intro, rights statement, then each day's reading, focus line, lesson, reflection question and full KJV text |
| `kit/gospels-30-days.html` | The same content, styled to print; use it for the PDF |
| `kit/days/day-NN.md` | One file per day, for pasting into the Edovo Editor one lesson at a time |
| `kit/lessons.json` | Cached AI lessons with model, tokens and timestamps |

Rebuild: `node scripts/export-edovo-course.mjs` (cached lessons are reused; `--redo 3,10` regenerates days; `--no-ai` writes placeholders). Lessons are checked mechanically before they are kept: 140 to 260 words, zero em or en dashes, and every quoted passage must match KJV wording in the bundled text.

**PDF:** no PDF library is in `package.json`, so print the HTML. Open `kit/gospels-30-days.html` in Chrome, press Ctrl+P, choose "Save as PDF". Headless: `chrome --headless --print-to-pdf=gospels-30-days.pdf docs/prison-ministry/kit/gospels-30-days.html`. The whole course is a large PDF (all four Gospels); per Edovo's 5 to 10 MB guidance, text-only output should fit, but check the size, and consider one PDF per week if Edovo asks.

## What Austin must do himself

1. **Read the kit.** Read every lesson before submitting. AI wrote the drafts; your name is on them. Fix anything with `--redo` or by editing `lessons.json` and rerunning.
2. **Decide the course shape** (see open decisions) and the rights-statement wording.
3. **Apply** at <https://forms.gle/5NJpTQPfDaQJPS998> as the content partner, in the name of whichever legal entity owns SureWord.
4. **Take the introductory call** and ask: the fee tier and price; whether a 30-lesson Bible course counts as one item; whether course assessments are required for a certificate; whether the course can be published to CDCR facilities specifically; and whether a nonprofit or ministry rate exists.
5. **Sign the contract** and get Edovo Editor credentials.
6. **Give the permission statement** they ask for. Suggested text: "The King James Version of the Bible is in the public domain in the United States. All lessons, focus lines and reflection questions in this course are original works written for SureWord and owned by [legal entity], which grants Edovo permission to publish and distribute them on its platform."
7. **Build the course in the Edovo Editor** from `kit/days/` (or ask Edovo to upload it), add knowledge checks if they require them, preview, and submit for screening.
8. **Wait for screening** (up to 30 business days) and answer reviewer changes.

## Open decisions

- **Your testimony.** Whether to mention that you came to faith in prison, in the application or in a short course introduction, is your call. If you do, keep it to the faith story; do not include details of your case. Nothing in this kit mentions it.
- **One course or four.** One 30-day course is one item and one certificate. Four weekly courses (Matthew, Mark, Luke, John) fit Edovo's checkpoint guidance better and give learners more completions, but cost four items.
- **Knowledge checks.** The kit has one reflection question per day. Courses may need graded checks to award a certificate (**unverified**). The script can be extended to generate one multiple-choice question per day if Edovo requires it.
- **The SureWord name.** Edovo bans marketing. The course title says "A SureWord Bible Course" and the rights statement names SureWord. Ask whether the brand line is acceptable or should be removed.
- **Spanish edition.** Edovo has an Español category (BPH deck, page 4). A Reina-Valera 1909 (public domain) edition would be a separate item.
- **Fees and who pays.** Unknown until the call.

## Not verified

- Edovo's exact fees, whether a 30-day course is one item, and certificate requirements for courses.
- How BPH panels actually weigh faith courses; the cited deck is Edovo's own pitch.
- Tablet network and app restrictions beyond "no wireless access" and Edovo-only content.
- The date Amazing Facts content went live (the announcement says May 18, year not confirmed).
