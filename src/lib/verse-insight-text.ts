/**
 * Every client draws a verse insight as plain text (Android `Text`, the Apple
 * `Text(text)`, the web `<p>`), but a verified insight carries the Scripture
 * block the verifier expands from a `[[SCRIPTURE:…]]` marker, which is
 * Markdown: a `**Reference (KJV)**` line and `> 8 verse text` lines. Readers
 * saw the raw asterisks and angle brackets.
 *
 * This only changes presentation, after verification and never before: no
 * word of Scripture or prose is added, removed or reordered, so the text a
 * reader sees is still exactly the text that was checked. The cache keeps the
 * verified original; this runs on every response, cached or fresh.
 */
export function plainVerseInsight(text: string): string {
	const out: string[] = [];
	let inPassage = false;
	for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
		const quote = /^>\s?(.*)$/.exec(line);
		if (quote) {
			out.push(quote[1]);
			inPassage = true;
			continue;
		}
		// Keep the passage visually apart from the prose that follows it.
		if (inPassage && line.trim() !== "") out.push("");
		inPassage = false;
		out.push(line.replace(/\*\*([^*\n]+)\*\*/g, "$1"));
	}
	return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
