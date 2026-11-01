import type { Note, Tag } from "./types";

/** Visible note text: one separator per leaf block, never per wrapper.
 * HTML layout whitespace collapses; explicit breaks and preformatted text stay. */
export function htmlToPlainText(html: string): string {
	const decode = (text: string) => text
		.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"').replace(/&#3[49];/g, "'").replace(/&amp;/gi, "&");
	// Raw script/style contents are not HTML token streams (e.g. a < b).
	const source = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
	if (!/<[a-z/!][^>]*>/i.test(source)) return decode(source).trim();
	const blocks: string[] = [];
	let current: string | null = null;
	let preDepth = 0;
	let skipDepth = 0;
	const items: boolean[] = [];
	const wrappers: boolean[] = [];
	const finish = () => {
		if (current === null) return;
		blocks.push(preDepth ? current : current.replace(/^ +| +$/g, ""));
		current = null;
		if (items.length) items[items.length - 1] = true;
		for (let index = 0; index < wrappers.length; index++) wrappers[index] = true;
	};
	const voidTags = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
	const tokens = source.match(/<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</g) ?? [];
	for (const token of tokens) {
		if (token.startsWith("<!--")) continue;
		const tag = /^<\s*(\/?)\s*([a-z][\w:-]*)\b/i.exec(token);
		if (!tag) {
			if (skipDepth || token.startsWith("<!")) continue;
			const text = preDepth ? decode(token) : decode(token).replace(/[ \t\r\n]+/g, " ");
			if (text === " " && (current === null || current === "")) continue;
			current = (current ?? "") + text;
			continue;
		}
		const closing = tag[1] === "/", name = tag[2].toLowerCase();
		const selfClosing = /\/\s*>$/.test(token) || voidTags.test(name);
		if (skipDepth) { skipDepth += closing ? -1 : selfClosing ? 0 : 1; continue; }
		if (!closing && /^(script|style|noscript|label)$/.test(name)) { if (!selfClosing) skipDepth = 1; continue; }
		if (name === "br") { if (!closing) current = (current ?? "") + "\n"; continue; }
		if (name === "hr") { if (!closing) { finish(); current = ""; finish(); } continue; }
		if (name === "div" || name === "tr") {
			finish();
			if (!closing) wrappers.push(false);
			else { if (wrappers.at(-1) === false) { current = ""; finish(); } wrappers.pop(); }
			continue;
		}
		if (/^(p|h[1-6])$/.test(name)) { finish(); if (!closing) current = ""; continue; }
		if (/^(blockquote|ul|ol|li|pre)$/.test(name)) {
			finish();
			if (name === "li") {
				if (!closing) items.push(false);
				else { if (items.at(-1) === false) { current = ""; finish(); } items.pop(); }
			}
			if (name === "pre") preDepth = Math.max(0, preDepth + (closing ? -1 : 1));
		}
	}
	finish();
	return blocks.join("\n");
}

export function countWords(text: string): number {
	const trimmed = text.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** True for the empty documents Tiptap produces ("", "<p></p>", "<p><br></p>"). */
export function isBlankHtml(html: string): boolean {
	return htmlToPlainText(html).trim() === "";
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
