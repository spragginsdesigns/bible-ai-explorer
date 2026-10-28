/**
 * Share cards on the clients: the pure half (docs/FEATURES.md, "Share cards").
 *
 * Byte-identical in mobile/src/features/shareCards/shareCards.ts (Android) and
 * src/lib/share-cards/targets.ts (web); tests/share-cards.test.mjs fails if
 * the two drift. The server draws every card (src/lib/share-cards/render.tsx),
 * so this module only decides WHICH card a share means and where to fetch it.
 * It imports nothing, so both test runners can pin the contract that matters
 * most: a card URL never carries the words themselves (the verse route looks
 * Scripture up by reference) and the personal cross card always goes out
 * with the session.
 */

export type ShareCardStyle = "dawn" | "parchment" | "sanctuary";
export type ShareCardFormat = "story" | "square";

/** Must match SHARE_CARD_DESIGN_VERSION on the server: it keys the CDN copy. */
export const SHARE_CARD_DESIGN_VERSION = "2";

/** Chip order and the two colours each chip's swatch blends between. */
export const SHARE_CARD_STYLES: readonly { id: ShareCardStyle; label: string; swatch: readonly [string, string] }[] = [
	{ id: "dawn", label: "Dawn", swatch: ["#f2b55c", "#1b1a14"] },
	{ id: "parchment", label: "Parchment", swatch: ["#e7cf98", "#b98a45"] },
	{ id: "sanctuary", label: "Sanctuary", swatch: ["#3a3226", "#0d0c0a"] },
];

/** Width over height, so the preview holds its shape before the image lands. */
export const SHARE_CARD_FORMATS: readonly { id: ShareCardFormat; label: string; aspectRatio: number }[] = [
	{ id: "story", label: "Story", aspectRatio: 1080 / 1920 },
	{ id: "square", label: "Square", aspectRatio: 1 },
];

export const DEFAULT_SHARE_CARD_STYLE: ShareCardStyle = "dawn";
export const DEFAULT_SHARE_CARD_FORMAT: ShareCardFormat = "story";

export type ShareCardTarget =
	| {
			kind: "verse";
			/** "John 3:16" or a range within one chapter, "Psalms 23:1-4". */
			reference: string;
			/** A translation id, or the reader's "LC Greek" label (no card for that). */
			translation: string;
	  }
	| {
			kind: "cross";
			/** The VerseOfDay row id. */
			id: string;
			reference: string;
	  }
	| {
			kind: "answer";
			conversationId: string;
			messageId: string;
	  };

/** The translations the server can look up and draw: every one we serve. */
const CARD_TRANSLATIONS = ["KJV", "BSB", "NKJV", "ASV", "RV1909", "LUT1912"] as const;
export type CardTranslation = (typeof CARD_TRANSLATIONS)[number];

export function cardTranslation(label: string): CardTranslation | null {
	const upper = label.trim().toUpperCase();
	return (CARD_TRANSLATIONS as readonly string[]).includes(upper) ? (upper as CardTranslation) : null;
}

/** Mirrors MAX_CARD_VERSES on the server: the reader's selection limit. */
export const MAX_CARD_VERSES = 10;

/**
 * How many verses "John 3:16-18" spans: 3. A single verse, or a reference
 * this cannot read, counts as 1, and the server stays the judge of those.
 */
export function cardVerseCount(reference: string): number {
	const range = reference.trim().match(/:([0-9]+) *- *([0-9]+)$/);
	if (!range) return 1;
	const span = Number(range[2]) - Number(range[1]) + 1;
	return span > 0 ? span : 1;
}

/**
 * Whether this share can be a picture. A verse in a translation the server
 * cannot draw (the LC Greek), or a chat passage longer than a card holds
 * (1 Corinthians 13:1-13), shares as text only, rather than as a card that
 * would silently swap in the KJV or an error that never clears.
 */
export function canDrawCard(target: ShareCardTarget): boolean {
	if (target.kind !== "verse") return true;
	return cardTranslation(target.translation) !== null && cardVerseCount(target.reference) <= MAX_CARD_VERSES;
}

/** Mirrors MAX_WORD_PASSAGE_VERSES on the server: the most a "send a word" card carries. */
export const MAX_WORD_VERSES = 4;

/**
 * The passage "Send to someone" carries out of a Share sheet: a verse the
 * server can draw, or the day's verse, when it is short enough for a word
 * card, so the draft is never refused for its length. Null for an answer
 * or a longer passage, which hides the button.
 */
export function sendWordReference(target: ShareCardTarget): string | null {
	if (target.kind === "answer") return null;
	if (target.kind === "verse" && !canDrawCard(target)) return null;
	return cardVerseCount(target.reference) <= MAX_WORD_VERSES ? target.reference : null;
}

/** The personal cards need the session; verse cards are public. */
export function cardNeedsSession(target: ShareCardTarget): boolean {
	return target.kind === "cross";
}

export interface CardRequest {
	style: ShareCardStyle;
	format: ShareCardFormat;
	size: "full" | "preview";
	/**
	 * Draw the verse's encouragement line. Only after POST
	 * /api/cards/encouragement has written it; the card route refuses (409)
	 * a note it does not have.
	 */
	note?: boolean;
	/** The device's IANA zone, so the cross card's date is the reader's day. */
	timeZone?: string;
}

/**
 * The path (on API_URL) of one card, or null when this share cannot be a
 * picture yet: a verse the server cannot draw, or an answer whose public link
 * has not been minted (`sharedAnswerId`).
 */
export function shareCardPath(
	target: ShareCardTarget,
	request: CardRequest,
	sharedAnswerId?: string | null
): string | null {
	const params = new URLSearchParams({ style: request.style, format: request.format });
	if (request.size === "preview") params.set("size", "preview");

	if (target.kind === "verse") {
		const translation = cardTranslation(target.translation);
		if (!translation) return null;
		// The server's canonical order, so a card URL never costs a redirect.
		const query = new URLSearchParams({ ref: target.reference, translation, style: request.style, format: request.format });
		if (request.note) query.set("note", "1");
		if (request.size === "preview") query.set("size", "preview");
		query.set("v", SHARE_CARD_DESIGN_VERSION);
		return `/api/cards/verse?${query.toString()}`;
	}
	if (target.kind === "cross") {
		if (request.timeZone) params.set("tz", request.timeZone);
		params.set("v", SHARE_CARD_DESIGN_VERSION);
		return `/api/cards/cross/${encodeURIComponent(target.id)}?${params.toString()}`;
	}
	if (!sharedAnswerId) return null;
	params.set("v", SHARE_CARD_DESIGN_VERSION);
	return `/api/shared/${encodeURIComponent(sharedAnswerId)}/image?${params.toString()}`;
}

/**
 * "John 3:16-17" to "john-3-16-17", the public page every verse and cross
 * card prints. Must match verseSlug in src/lib/share-cards/layout.ts (the
 * server's copy); tests/share-cards.test.mjs compares them.
 */
export function verseSlug(reference: string): string {
	return reference
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * The door as a link, for text shares: the page the card itself prints. Null
 * for a passage longer than a card, which has no page.
 */
export function verseDoorUrl(reference: string): string | null {
	if (cardVerseCount(reference) > MAX_CARD_VERSES) return null;
	return `https://sureword.app/v/${verseSlug(reference)}`;
}

/**
 * A personal card ("send a word"): the sender's own preview, which draws the
 * draft and needs the session, and the public image of the sent card.
 * `edit` changes with every saved edit so a client's file cache never shows
 * the line as it was before.
 */
export function personalPreviewPath(
	id: string,
	request: Pick<CardRequest, "style" | "format" | "size">,
	edit: number
): string {
	const params = new URLSearchParams({ style: request.style, format: request.format });
	if (request.size === "preview") params.set("size", "preview");
	params.set("t", String(edit));
	return `/api/cards/personal/${encodeURIComponent(id)}/image?${params.toString()}`;
}

export function personalCardPath(id: string, request: Pick<CardRequest, "style" | "format" | "size">): string {
	const params = new URLSearchParams({ style: request.style, format: request.format });
	if (request.size === "preview") params.set("size", "preview");
	params.set("v", SHARE_CARD_DESIGN_VERSION);
	return `/api/cards/c/${encodeURIComponent(id)}/image?${params.toString()}`;
}

/** "SureWord John 3-16.jpg": what the receiving app shows as the file name. */
export function shareCardFileName(target: ShareCardTarget, style: ShareCardStyle, format: ShareCardFormat): string {
	const label =
		target.kind === "answer" ? "Answer" : target.kind === "cross" ? `Cross ${target.reference}` : target.reference;
	const safe = label.replace(/[^A-Za-z0-9 ]+/g, "-").replace(/\s+/g, " ").trim();
	return `SureWord ${safe} ${style} ${format}.jpg`;
}

export interface ShareCardPrefs {
	style: ShareCardStyle;
	format: ShareCardFormat;
	/** Add the verse's line of encouragement. On unless the reader turned it off. */
	encourage: boolean;
}

export function parseStoredShareCardPrefs(raw: string | null): ShareCardPrefs {
	const prefs: ShareCardPrefs = {
		style: DEFAULT_SHARE_CARD_STYLE,
		format: DEFAULT_SHARE_CARD_FORMAT,
		encourage: true,
	};
	try {
		const value = raw ? (JSON.parse(raw) as { style?: unknown; format?: unknown; encourage?: unknown }) : null;
		if (SHARE_CARD_STYLES.some((option) => option.id === value?.style)) prefs.style = value?.style as ShareCardStyle;
		if (SHARE_CARD_FORMATS.some((option) => option.id === value?.format)) prefs.format = value?.format as ShareCardFormat;
		if (value?.encourage === false) prefs.encourage = false;
	} catch {
		// A corrupt preference is just the default.
	}
	return prefs;
}
