import type { Note, Tag } from "./types";

const BLOCK_CLOSE = /<\/(p|div|h[1-6]|li|blockquote|tr|pre)>/gi;

/**
 * Native has no DOM, so plainText/wordCount are derived from the editor HTML
 * here instead of from Tiptap's getText().
 */
export function htmlToPlainText(html: string): string {
	if (!html) return "";
	return html
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(BLOCK_CLOSE, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#3[49];/g, "'")
		.replace(/&amp;/gi, "&")
		.replace(/[ \t]+/g, " ")
		.replace(/ ?\n ?/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function countWords(text: string): number {
	const trimmed = text.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** True for the empty documents Tiptap produces ("", "<p></p>", "<p><br></p>"). */
export function isBlankHtml(html: string): boolean {
	return htmlToPlainText(html) === "";
}

/**
 * The web stores Tiptap JSON in `content` and HTML in `htmlContent`, but older
 * notes can have HTML in both. Prefer htmlContent, fall back to content only
 * when it is not JSON.
 */
export function initialHtmlFor(note: Pick<Note, "content" | "htmlContent">): string {
	if (note.htmlContent && !isBlankHtml(note.htmlContent)) return note.htmlContent;
	const raw = note.content?.trim() ?? "";
	if (!raw) return "";
	if (raw.startsWith("{") || raw.startsWith("[")) return "";
	return raw;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "";
	const diff = Date.now() - then;
	if (diff < MINUTE) return "Just now";
	if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
	if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
	if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;

	const date = new Date(then);
	const thisYear = date.getFullYear() === new Date().getFullYear();
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		...(thisYear ? {} : { year: "numeric" }),
	});
}

export function tagsForNote(note: Pick<Note, "tagIds">, tags: Tag[]): Tag[] {
	return tags.filter((tag) => note.tagIds.includes(tag.id));
}
