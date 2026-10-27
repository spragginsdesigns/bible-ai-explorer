import { bookByOrder, resolveReference } from "@/lib/bible/books";

/**
 * Reading a passage the founder typed ("Romans 5:1-11", "Jn 3:1-21",
 * "James 2:14-26", "Psalm 23") for the Socratic Tutor. Shared by the picker,
 * which previews it, and the server, which checks it against the chapter's
 * real length before a session starts (`checkPassageRange`).
 */
export interface ParsedPassageInput {
	book: number;
	bookName: string;
	chapter: number;
	start: number;
	/** null: to the end of the chapter (a whole chapter, or "John 3:16-"). */
	end: number | null;
}

/** "<book> <chapter>[:<verse>[-<verse>]]"; a range that crosses chapters is refused. */
const PASSAGE_PATTERN = /^(.*?\D)\s*(\d+)(?:\s*:\s*(\d+)(?:\s*[-–—]\s*(\d+)?)?)?\s*$/;

export function parsePassageInput(input: string): ParsedPassageInput | { error: string } {
	const text = input.trim().replace(/\s+/g, " ");
	if (!text) return { error: "Type a passage, like Romans 5:1-11." };
	if (/\d+\s*:\s*\d+\s*[-–—]\s*\d+\s*:\s*\d+/.test(text)) return { error: "Keep the passage within one chapter." };
	const match = PASSAGE_PATTERN.exec(text);
	if (!match) return { error: "Use a passage like Romans 5:1-11 or Psalm 23." };
	const [, , chapterPart, startPart, endPart] = match;
	const located = resolveReference(startPart ? `${match[1].trim()} ${chapterPart}:${startPart}` : `${match[1].trim()} ${chapterPart}`);
	const meta = located ? bookByOrder(located.order) : null;
	if (!located || !meta) return { error: "That book or chapter was not found." };
	const start = located.verse ?? 1;
	// "John 3:16" is one verse, "John 3:16-" runs to the chapter's end, "John 3" is the chapter.
	const hasDash = /[-–—]\s*$/.test(text);
	const end = !startPart ? null : endPart ? Number(endPart) : hasDash ? null : start;
	if (end !== null && end < start) return { error: "The range must run forwards, like Romans 5:1-11." };
	return { book: meta.order, bookName: meta.name, chapter: located.chapter, start, end };
}
