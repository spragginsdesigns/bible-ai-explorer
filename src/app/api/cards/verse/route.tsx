import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { canonicalPassage } from "@/lib/bible/passage-context";
import { getChapter, type TranslationId } from "@/lib/bible/translations";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import {
	MAX_CARD_VERSES,
	SHARE_CARD_DESIGN_VERSION,
	cardScriptureText,
	parseShareCardFormat,
	parseShareCardSize,
	parseShareCardStyle,
} from "@/lib/share-cards/layout";
import { CardTooLongError, renderShareCard } from "@/lib/share-cards/render";

/**
 * A verse card (docs/FEATURES.md, "Share cards").
 *
 * GET /api/cards/verse?ref=John 3:16-17&translation=KJV&style=dawn&format=story&v=1
 *
 * Public on purpose (listed in `isPublicRoute`): the card holds nothing but
 * Scripture, which the server looks up itself from the reference. No text
 * from the caller is ever drawn, so the route cannot be used to put words in
 * SureWord's mouth, and a link to a card works in any chat app without a
 * session.
 *
 * Each card has exactly one URL. Anything else (another spelling of the
 * reference, an unknown style, a stray parameter, an old `v`) is redirected
 * there before any drawing, so random query strings cannot force a render per
 * request, and the CDN keeps one copy per card for a year. `v`
 * (SHARE_CARD_DESIGN_VERSION) moves every card to a new URL; bump it when the
 * look changes or the bundled text is corrected.
 */
export const runtime = "nodejs";

const TRANSLATIONS: readonly TranslationId[] = ["KJV", "BSB", "NKJV"];

const IMMUTABLE_CACHE = "public, max-age=86400, s-maxage=31536000, immutable";
/** A redirect may point at an old design version, so it is kept only a day. */
const REDIRECT_CACHE = "public, max-age=3600, s-maxage=86400";

/** A verse or a range within one chapter, the same shape `canonicalPassage` reads. */
const RANGE = /^([1-3]?\s*[a-zA-Z. ]+?)\s*(\d+)\s*:\s*(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?$/;

function failure(status: number, message: string): Response {
	return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

interface CardReference {
	/** "jn 3 : 16" and "John 3:16" are one card: the reference as the server writes it. */
	label: string;
	order: number;
	chapter: number;
	end: number;
}

function canonicalReference(input: string): CardReference | null {
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
		end,
	};
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const input = url.searchParams.get("ref")?.trim() ?? "";
	if (!input || input.length > 60) return failure(400, "Pass ref, e.g. John 3:16.");
	const parsed = canonicalReference(input);
	if (!parsed) {
		return failure(400, `Use one verse, or up to ${MAX_CARD_VERSES} verses within one chapter.`);
	}

	const requested = (url.searchParams.get("translation") ?? "KJV").toUpperCase();
	const translation = TRANSLATIONS.find((id) => id === requested);
	if (!translation) return failure(400, "translation must be KJV, BSB or NKJV.");

	const style = parseShareCardStyle(url.searchParams.get("style"));
	const format = parseShareCardFormat(url.searchParams.get("format"));
	const size = parseShareCardSize(url.searchParams.get("size"));
	const canonical = new URLSearchParams({ ref: parsed.label, translation, style, format });
	if (size === "preview") canonical.set("size", "preview");
	canonical.set("v", SHARE_CARD_DESIGN_VERSION);
	if (url.search !== `?${canonical.toString()}`) {
		return new Response(null, {
			status: 308,
			headers: { location: `${url.pathname}?${canonical.toString()}`, "cache-control": REDIRECT_CACHE },
		});
	}

	// Load the chapter first: a failure here is ours (bolls.life for the NKJV,
	// or the bundled text), while a verse past its end (John 3:99) is the
	// caller's, and only the first is worth a log line or a retry.
	let chapterLength: number;
	try {
		chapterLength = (await getChapter(translation, parsed.order, parsed.chapter)).length;
	} catch (error) {
		console.error("Verse card text failed to load:", error);
		return failure(translation === "NKJV" ? 502 : 500, "That passage could not be loaded. Try again.");
	}
	if (parsed.end > chapterLength) return failure(400, "That verse is not in this chapter.");

	const reference = parsed.label;
	let passage: Awaited<ReturnType<typeof canonicalPassage>>;
	try {
		passage = await canonicalPassage(reference, translation);
	} catch (error) {
		// The reference already parsed, so this is a load failure: bolls.life
		// for the NKJV, or the bundled text itself. Ours to retry, never cached.
		console.error("Verse card text failed to load:", error);
		return failure(translation === "NKJV" ? 502 : 500, "That passage could not be loaded. Try again.");
	}

	const verses = passage.verses.map((row) => ({
		verse: Number(row.reference.slice(row.reference.lastIndexOf(":") + 1)),
		text: bibleVersePlainText(row.text),
	}));
	if (!verses.some((row) => row.text)) return failure(404, "That passage has no text in this translation.");

	try {
		return await renderShareCard(
			{ kind: "verse", reference: passage.reference, translation, text: cardScriptureText(verses) },
			{ style, format, size, cacheControl: IMMUTABLE_CACHE }
		);
	} catch (error) {
		if (error instanceof CardTooLongError) return failure(422, error.message);
		throw error;
	}
}
