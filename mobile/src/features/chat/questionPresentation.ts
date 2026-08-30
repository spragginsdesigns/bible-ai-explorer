/**
 * Presentation for the opening "Chosen from your study" cards.
 *
 * Mirrored with `src/utils/questionPresentation.ts` on web - mobile is outside
 * the pnpm workspace, so the file is duplicated rather than imported. Keep both
 * copies in step.
 *
 * Every chip carries a small gold label: a Scripture reference when the
 * question is anchored to one, otherwise the source it was drawn from
 * ("YOUR NOTES", "TODAY'S VERSE", and so on). The server supplies the label;
 * the regex below is only the fallback for a null label - a set stored before
 * labels existed, or a client talking to an older deploy.
 *
 * Every dash here is written as an escape on purpose: this file is edited on
 * Windows, where a literal en dash does not survive every editor round-trip,
 * and a mangled one inside the character class silently changes the regex.
 */

const EN_DASH = "–";

const BIBLE_BOOK =
	"(?:[1-3]\\s*)?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation)";

// Book, then a chapter or chapter range, then optionally a verse or verse range.
const REFERENCE_BODY = `${BIBLE_BOOK}\\s+\\d+(?:[-\\u2013]\\d+)?(?::\\d+(?:[-\\u2013]\\d+)?)?`;

const SCRIPTURE_REFERENCE = new RegExp(`\\b(${REFERENCE_BODY})`, "i");
const SCRIPTURE_REFERENCE_EXACT = new RegExp(`^${REFERENCE_BODY}$`, "i");

/** "of" in "Song of Solomon" stays lower - every other word is capitalized. */
const LOWERCASE_WORDS = new Set(["of"]);

/** Canonical display form: "1 samuel 3:1-10" becomes "1 Samuel 3:1<en dash>10". */
function normalizeReferenceText(raw: string): string {
	return raw
		.trim()
		.replace(/\s+/g, " ")
		.replace(/^([1-3])\s*/, "$1 ")
		.replace(/-/g, EN_DASH)
		.replace(/[A-Za-z]+/g, (word: string, offset: number) => {
			const lower = word.toLowerCase();
			if (offset > 0 && LOWERCASE_WORDS.has(lower)) return lower;
			return lower.charAt(0).toUpperCase() + lower.slice(1);
		});
}

/** Pull a real reference from the question text without inventing one. */
export function questionReference(question: string): string | null {
	const match = question.match(SCRIPTURE_REFERENCE)?.[1];
	return match ? normalizeReferenceText(match) : null;
}

/** A label that is meant to BE a reference - the whole label must parse as one. */
export function parseReferenceLabel(label: string): string | null {
	const trimmed = label.trim().replace(/\s+/g, " ");
	return SCRIPTURE_REFERENCE_EXACT.test(trimmed) ? normalizeReferenceText(trimmed) : null;
}

/** One question as the API delivers it. `label` may be absent on older payloads. */
export interface SuggestedQuestionInput {
	question: string;
	label?: string | null;
}

export interface SuggestedQuestionItem {
	key: string;
	question: string;
	/** Upper-case, ready to render in the gold slot. Null when nothing applies. */
	label: string | null;
}

/** Accept the current object shape, and a bare string from an older deploy. */
export function parseSuggestedQuestions(value: unknown): SuggestedQuestionInput[] {
	if (!Array.isArray(value)) return [];
	const parsed: SuggestedQuestionInput[] = [];
	for (const entry of value) {
		if (typeof entry === "string") {
			if (entry.length > 0) parsed.push({ question: entry, label: null });
			continue;
		}
		if (typeof entry !== "object" || entry === null) continue;
		const { question, label } = entry as { question?: unknown; label?: unknown };
		if (typeof question !== "string" || question.length === 0) continue;
		parsed.push({ question, label: typeof label === "string" && label.length > 0 ? label : null });
	}
	return parsed;
}

/**
 * Read `GET /api/suggested-questions`. The route sends `items` (labelled) and
 * `questions` (the plain strings every already-installed client reads, same
 * order). Prefer `items`; fall back to `questions` when talking to a deploy
 * that predates labels, where the regex supplies what label it can.
 */
export function parseSuggestedQuestionsResponse(payload: unknown): SuggestedQuestionInput[] {
	if (typeof payload !== "object" || payload === null) return [];
	const { items, questions } = payload as { items?: unknown; questions?: unknown };
	const labelled = parseSuggestedQuestions(items);
	return labelled.length > 0 ? labelled : parseSuggestedQuestions(questions);
}

/** Preserve every generated question, in order, while adding presentation-only metadata. */
export function buildSuggestedQuestionItems(
	questions: readonly (string | SuggestedQuestionInput)[]
): SuggestedQuestionItem[] {
	return questions.map((entry, index) => {
		const question = typeof entry === "string" ? entry : entry.question;
		const supplied = typeof entry === "string" ? null : entry.label?.trim();
		const label = supplied && supplied.length > 0 ? supplied : questionReference(question);
		return {
			key: `${index}:${question}`,
			question,
			label: label ? label.toUpperCase() : null,
		};
	});
}
