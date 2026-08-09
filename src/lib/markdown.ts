import { marked } from "marked";

/** Convert model-authored markdown to HTML that Tiptap can parse, with a
 * conservative strip of active content (the Tiptap schema drops it anyway,
 * but htmlContent is stored verbatim until the next editor round-trip). */
export function markdownToNoteHtml(markdown: string): string {
	const html = marked.parse(markdown, { async: false }) as string;
	return html
		.replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
		.replace(/\son\w+="[^"]*"/gi, "")
		.replace(/\shref="javascript:[^"]*"/gi, "")
		.trim();
}

export function htmlToPlainText(html: string): string {
	return html
		.replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function countWords(text: string): number {
	const trimmed = text.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}
