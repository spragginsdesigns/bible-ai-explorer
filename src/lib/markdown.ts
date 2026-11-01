import { marked } from "marked";

/** Convert model-authored markdown to HTML that Tiptap can parse, with a
 * conservative strip of active content (the Tiptap schema drops it anyway,
 * but htmlContent is stored verbatim until the next editor round-trip). */
export function markdownToNoteHtml(markdown: string): string {
	const html = marked.parse(markdown, { async: false, breaks: true }) as string;
	return html
		.replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
		.replace(/\son\w+="[^"]*"/gi, "")
		.replace(/\shref="javascript:[^"]*"/gi, "")
		.trim();
}

export { htmlToPlainText } from "./note-plain-text.mjs";

export function countWords(text: string): number {
	const trimmed = text.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}
