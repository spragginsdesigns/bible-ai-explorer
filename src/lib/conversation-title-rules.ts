/**
 * Pure rules for automatic conversation titles, kept free of Prisma and the
 * model so the decisions about when a title may be replaced, and what a
 * generated title must look like, are unit testable on their own.
 *
 * Non-ASCII characters in the patterns below are written as \u escapes on
 * purpose: editors and shells on the dev machine flatten literal dashes.
 */

/** Longest title the clients render; also the ceiling a generated title must fit. */
export const MAX_CONVERSATION_TITLE_LENGTH = 60;
export const MIN_TITLE_WORDS = 2;
export const MAX_TITLE_WORDS = 6;

/** Titles the server and older clients fall back to when there was nothing to truncate. */
const PLACEHOLDER_TITLES = new Set(["new conversation", "new chat"]);

/**
 * Web and Android title an attachment-only first message
 * `Attachment: <filename>`, because the message itself has no text.
 */
const ATTACHMENT_TITLE_PREFIX = "Attachment: ";

/**
 * A verse attached from the reader or the daily cross goes out first as
 * `John 3:16 <em dash> "For God so loved..." (KJV)` (formatVerseForSharing),
 * so its title is a reference and a quotation rather than anything the user
 * chose. Only the reference half is matched: the clients cut at 60
 * characters, often mid-verse.
 */
const VERSE_FIRST_TITLE =
	/^(?:[1-3]\s?)?[A-Za-z][A-Za-z ]*\s\d+(?::\d+(?:[-\u2013]\d+)?)?\s[\u2014\u2013-]\s/;

export interface AutoTitleCandidate {
	title: string;
	/** Content of the conversation's first user message, or null when there is none. */
	firstUserText: string | null;
	assistantMessageCount: number;
}

/**
 * True when a conversation still carries the title a client set mechanically
 * and has just received its first answer, so a written title may replace it.
 *
 * Once per conversation by construction: the second answer makes the count 2,
 * and a title the user typed is not a prefix of their first message. The write
 * is additionally guarded by the old title, so a rename that lands between
 * this check and the update still wins.
 */
export function shouldAutoTitle(conversation: AutoTitleCandidate): boolean {
	if (conversation.assistantMessageCount !== 1) return false;

	const title = conversation.title.trim();
	if (!title) return true;
	if (PLACEHOLDER_TITLES.has(title.toLowerCase())) return true;
	if (title.startsWith(ATTACHMENT_TITLE_PREFIX)) return true;
	if (title.startsWith(">")) return true;
	if (VERSE_FIRST_TITLE.test(title)) return true;

	const firstUserText = conversation.firstUserText?.trim() ?? "";
	return firstUserText.length > 0 && firstUserText.startsWith(title);
}

/** Minor words stay lowercase inside a title-cased title. */
const MINOR_WORDS = new Set([
	"a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "vs", "via",
]);

/**
 * Title case that never lowers a capital the model chose on purpose: "LORD",
 * "KJV" and "McCheyne" all carry a capital past their first letter and are
 * left alone.
 */
function toTitleCase(words: readonly string[]): string {
	return words
		.map((word, index) => {
			const letters = word.replace(/[^\p{L}]/gu, "");
			if (/\p{Lu}/u.test(letters.slice(1))) return word;
			const edge = index === 0 || index === words.length - 1;
			if (!edge && MINOR_WORDS.has(letters.toLowerCase())) return word.toLowerCase();
			return word.replace(/\p{L}/u, (first) => first.toUpperCase());
		})
		.join(" ");
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Emoji, flags, and the joiners and variation selectors that build them. */
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
/** Double quotes of every style, plus markdown emphasis and heading markers. */
const QUOTES_AND_MARKUP = /[*_`#"“”„«»]/g;
/** Single quotes only at the edges, so "Jesus' Parables" and "God's Promises" survive. */
const EDGE_SINGLE_QUOTES = /^['‘’\s]+|['‘’\s]+$/g;
const LEADING_PUNCTUATION = /^[\s.,;:!?\u2026\u2014\u2013-]+/;
const TRAILING_PUNCTUATION = /[\s.,;:!?\u2026\u2014\u2013-]+$/;

/**
 * Normalize a model's title, or return null when it cannot be used - in which
 * case the conversation keeps the title it has.
 *
 * Strips what models add around a title (a "Title:" label, markdown markers,
 * quotes, emoji, trailing punctuation), then rejects rather than repairs:
 * a title over the length limit, outside two to six words, or naming the
 * user is dropped, because a truncated or personal title is worse than the
 * plain first line of the question.
 */
export function cleanGeneratedTitle(
	text: string,
	options: { forbiddenNames?: readonly (string | null | undefined)[] } = {},
): string | null {
	const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? "";

	let cleaned = firstLine.replace(/^title\s*:\s*/i, "").replace(EMOJI, "").replace(QUOTES_AND_MARKUP, "");
	// Twice, because stripping trailing punctuation can expose a closing quote
	// ("'Grace Alone'.") and stripping a quote can expose punctuation.
	for (let pass = 0; pass < 2; pass++) {
		cleaned = cleaned
			.replace(EDGE_SINGLE_QUOTES, "")
			.replace(LEADING_PUNCTUATION, "")
			.replace(TRAILING_PUNCTUATION, "");
	}
	cleaned = cleaned.replace(/\s+/g, " ").trim();

	if (!cleaned || cleaned.length > MAX_CONVERSATION_TITLE_LENGTH) return null;

	const words = cleaned.split(" ");
	if (words.length < MIN_TITLE_WORDS || words.length > MAX_TITLE_WORDS) return null;

	for (const name of options.forbiddenNames ?? []) {
		const trimmed = name?.trim();
		if (!trimmed || trimmed.length < 2) continue;
		if (new RegExp(`(^|[^\\p{L}])${escapeRegExp(trimmed)}($|[^\\p{L}])`, "iu").test(cleaned)) return null;
	}

	return toTitleCase(words);
}
