import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { MAX_CARD_VERSES } from "./layout";

/**
 * The references a share card accepts: one verse, or up to MAX_CARD_VERSES
 * within one chapter. Shared by the card routes, the encouragement route and
 * the public verse pages, so all of them name a passage the same way.
 */

/** A verse or a range within one chapter, the same shape `canonicalPassage` reads. */
const RANGE = /^([1-3]?\s*[a-zA-Z. ]+?)\s*(\d+)\s*:\s*(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?$/;

export interface CardReference {
	/** "jn 3 : 16" and "John 3:16" are one card: the reference as the server writes it. */
	label: string;
	order: number;
	chapter: number;
	start: number;
	end: number;
}

export function canonicalCardReference(input: string): CardReference | null {
	const ref = resolveReference(input);
	const range = input.match(RANGE);
	const book = ref ? bookByOrder(ref.order) : undefined;
	if (!ref?.verse || !range || !book) return null;
	const end = Number(range[4] ?? ref.verse);
	if (!Number.isInteger(end) || end < ref.verse || end - ref.verse + 1 > MAX_CARD_VERSES) return null;
	return {
		label: `${book.name} ${ref.chapter}:${ref.verse}${end > ref.verse ? `-${end}` : ""}`,
		order: ref.order,
		chapter: ref.chapter,
		start: ref.verse,
		end,
	};
}

/** "song-of-solomon-2-1" or "1-john-1-9-10" (a verse page slug) back to a reference. */
export function referenceFromSlug(slug: string): CardReference | null {
	const match = slug.toLowerCase().match(/^([1-3]-)?([a-z]+(?:-[a-z]+)*)-([0-9]{1,3})-([0-9]{1,3})(?:-([0-9]{1,3}))?$/);
	if (!match) return null;
	const [, number, name, chapter, start, end] = match;
	const book = `${number ? `${number[0]} ` : ""}${name.replace(/-/g, " ")}`;
	return canonicalCardReference(`${book} ${chapter}:${start}${end ? `-${end}` : ""}`);
}
