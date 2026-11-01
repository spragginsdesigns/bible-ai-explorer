/** Visible note text: one separator per leaf block, never per wrapper.
 * HTML layout whitespace collapses; explicit breaks and preformatted text stay. */
export function htmlToPlainText(html) {
	const decode = (text) => text
		.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&amp;/gi, "&");
	// Raw script/style contents are not HTML token streams (e.g. a < b).
	const source = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
	if (!/<[a-z/!][^>]*>/i.test(source)) return decode(source).trim();
	const blocks = [];
	let current = null;
	let preDepth = 0;
	let skipDepth = 0;
	const items = [];
	const wrappers = [];
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
