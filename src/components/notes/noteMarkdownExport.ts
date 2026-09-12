import { htmlToMarkdown } from "@/utils/markdownConverter";

/**
 * Obsidian-ready note export: an H1 with the note's title, a blank line, then
 * the Turndown-converted body. Reads the editor's live HTML, so unsaved
 * debounced edits are included.
 */
export function noteHtmlToMarkdown(title: string, html: string): string {
	const heading = `# ${title.trim() || "Untitled Note"}`;
	const body = htmlToMarkdown(html).trim();
	return body ? `${heading}\n\n${body}\n` : `${heading}\n`;
}
