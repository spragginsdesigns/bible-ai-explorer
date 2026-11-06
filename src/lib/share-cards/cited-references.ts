/**
 * The references a shared answer actually cites.
 *
 * A share snapshot's `references` come from `extractReferences`, which records
 * the verses retrieval pulled up for the turn (`retrievedVerses`) before the
 * ones the answer used. Retrieval returns several candidates, so the public
 * page listed every one of them as "Scripture referenced" and the card printed
 * the first as the answer's verse: a waterfall answer quoting Psalm 93:4 went
 * out labelled HABAKKUK 3:10.
 *
 * The snapshot itself is never rewritten (public reads compare it exactly with
 * the checked source), so this filters at display time instead: a reference
 * is shown only when the answer text cites it. No match shows no reference,
 * never a verse the answer did not use.
 */
function normalize(text: string): string {
	return text
		.normalize("NFC")
		.toLowerCase()
		.replace(/[\u2010-\u2015]/g, "-")
		.replace(/\s+/g, " ")
		.replace(/\bpsalms\b/g, "psalm")
		.replace(/\bsong of songs\b/g, "song of solomon");
}

function cites(text: string, reference: string): boolean {
	const ref = normalize(reference).trim();
	if (!ref) return false;
	const pattern = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
	// Not inside a longer name or number: "John 3:1" is not cited by
	// "1 John 3:1" or by "John 3:16".
	return new RegExp(`(?<![\\p{L}\\p{N}])(?<!\\p{N}\\s)${pattern}(?!\\p{N}|:\\p{N})`, "u").test(text);
}

export function citedReferences(answer: string, references: readonly string[]): string[] {
	const text = normalize(answer);
	return references.filter(reference => cites(text, reference));
}
