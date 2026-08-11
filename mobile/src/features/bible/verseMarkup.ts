export interface BibleVerseSegment {
	text: string;
	italic: boolean;
}

const TAG = /<[^>]*>/g;

function decodeEntities(text: string): string {
	return text.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, name: string) => {
		const normalized = name.toLowerCase();
		if (normalized.startsWith("#x")) {
			return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
		}
		if (normalized.startsWith("#")) {
			return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
		}
		return (
			{
				amp: "&",
				apos: "'",
				gt: ">",
				lt: "<",
				nbsp: " ",
				quot: '"'
			}[normalized] ?? entity
		);
	});
}

/**
 * bolls.life marks supplied words with inline HTML italics. React Native Text
 * does not interpret HTML, so translate only the supported emphasis tags into
 * safe text segments and discard any other provider markup.
 */
export function parseBibleVerseMarkup(markup: string): BibleVerseSegment[] {
	const segments: BibleVerseSegment[] = [];
	let italicDepth = 0;
	let cursor = 0;

	const append = (rawText: string) => {
		const text = decodeEntities(rawText);
		if (!text) return;
		const italic = italicDepth > 0;
		const previous = segments.at(-1);
		if (previous?.italic === italic) previous.text += text;
		else segments.push({ text, italic });
	};

	for (const match of markup.matchAll(TAG)) {
		const index = match.index ?? 0;
		append(markup.slice(cursor, index));
		const tag = match[0].toLowerCase();
		if (/^<(i|em)(?:\s[^>]*)?>$/.test(tag)) italicDepth += 1;
		else if (/^<\/(i|em)\s*>$/.test(tag)) italicDepth = Math.max(0, italicDepth - 1);
		cursor = index + match[0].length;
	}

	append(markup.slice(cursor));
	return segments;
}

export function bibleVersePlainText(markup: string): string {
	return parseBibleVerseMarkup(markup)
		.map((segment) => segment.text)
		.join("");
}
