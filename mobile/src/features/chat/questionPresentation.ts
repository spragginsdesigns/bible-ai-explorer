const BIBLE_BOOK =
	"(?:[1-3]\\s*)?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation)";

const SCRIPTURE_REFERENCE = new RegExp(
	`\\b(${BIBLE_BOOK}\\s+\\d+(?::\\d+(?:[-–]\\d+)?)?)`,
	"i",
);

export interface SuggestedQuestionItem {
	key: string;
	question: string;
	reference: string | null;
}

/** Pull a real reference from the generated question without inventing one. */
export function questionReference(question: string): string | null {
	const match = question.match(SCRIPTURE_REFERENCE)?.[1];
	return match ? match.replace(/-/g, "–").toUpperCase() : null;
}

/** Preserve every generated question, in order, while adding presentation-only metadata. */
export function buildSuggestedQuestionItems(questions: string[]): SuggestedQuestionItem[] {
	return questions.map((question, index) => ({
		key: `${index}:${question}`,
		question,
		reference: questionReference(question),
	}));
}
