import TurndownService from "turndown";

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
	bulletListMarker: "-",
});

// Custom rule for task lists
turndown.addRule("taskListItem", {
	filter: (node) =>
		node.nodeName === "LI" &&
		node.parentNode !== null &&
		(node.parentNode as Element).getAttribute?.("data-type") === "taskList",
	replacement: (content, node) => {
		const checkbox = (node as Element).querySelector('input[type="checkbox"]');
		const checked = checkbox?.hasAttribute("checked") ? "x" : " ";
		return `- [${checked}] ${content.trim()}\n`;
	},
});

export function htmlToMarkdown(html: string): string {
	if (!html) return "";
	return turndown.turndown(html);
}

export function markdownToHtml(markdown: string): string {
	if (!markdown) return "";

	let html = markdown;

	// Headings
	html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
	html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
	html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

	// Bold, italic, underline
	html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
	html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

	// Blockquotes
	html = html.replace(/^> (.+)$/gm, "<blockquote><p>$1</p></blockquote>");

	// Code blocks
	html = html.replace(/```[\s\S]*?```/g, (match) => {
		const code = match.slice(3, -3).trim();
		return `<pre><code>${code}</code></pre>`;
	});

	// Inline code
	html = html.replace(/`(.+?)`/g, "<code>$1</code>");

	// Task lists
	html = html.replace(
		/^- \[(x| )\] (.+)$/gm,
		(_, checked, text) =>
			`<ul data-type="taskList"><li data-type="taskItem" data-checked="${checked === "x"}"><label><input type="checkbox" ${checked === "x" ? "checked" : ""}>${text}</label></li></ul>`
	);

	// Unordered lists
	html = html.replace(/^- (.+)$/gm, "<ul><li>$1</li></ul>");

	// Paragraphs (lines that aren't already wrapped)
	html = html
		.split("\n")
		.map((line) => {
			if (!line.trim()) return "";
			if (line.startsWith("<")) return line;
			return `<p>${line}</p>`;
		})
		.join("\n");

	return html;
}
