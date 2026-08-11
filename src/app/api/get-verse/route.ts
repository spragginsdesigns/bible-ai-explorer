import { NextResponse } from "next/server";
import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { getChapter, type TranslationId } from "@/lib/bible/translations";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Resolve the reference and fetch its text from the reader's translation source. */
async function lookupSelectedTranslation(reference: string, translation: TranslationId) {
	const cleaned = reference.replace(/\s+(?:KJV|NKJV)$/i, "").trim();
	const target = resolveReference(cleaned);
	if (!target) return null;

	// resolveReference drops the range end, so recover it from the reference
	// text ("John 3:16-18") to quote the whole range.
	const rangeEnd = cleaned.match(/[-–—]\s*(\d+)\s*$/);
	const verseStart = target.verse ?? 1;
	const verseEnd = rangeEnd ? Number.parseInt(rangeEnd[1], 10) : verseStart;

	const book = bookByOrder(target.order);
	if (!book) return null;

	try {
		const chapterVerses = await getChapter(translation, target.order, target.chapter);
		const selected = chapterVerses.slice(verseStart - 1, verseEnd);
		if (selected.length === 0) return null;
		return {
			reference: `${book.name} ${target.chapter}:${verseStart}${verseEnd > verseStart ? `-${verseEnd}` : ""}`,
			text: selected.join(" "),
			verses: selected.map((text, index) => ({
				book: book.name,
				chapter: target.chapter,
				verse: verseStart + index,
				text,
			})),
			translation,
		};
	} catch {
		return null;
	}
}

export async function POST(req: Request) {
	try {
		const body: unknown = await req.json();
		const reference = isRecord(body) ? body.reference : undefined;
		const translation: TranslationId =
			isRecord(body) && body.translation === "NKJV" ? "NKJV" : "KJV";

		if (!reference || typeof reference !== "string") {
			return NextResponse.json(
				{ error: "Invalid input: 'reference' must be a non-empty string." },
				{ status: 400 }
			);
		}

		// KJV keeps the legacy bible-api.com lookup; other translations go
		// through the reader's chapter loader (NKJV via bolls.life).
		if (translation !== "KJV") {
			const result = await lookupSelectedTranslation(reference, translation);
			if (!result) {
				return NextResponse.json({
					verses: [],
					reference,
					error: `Verse not found in ${translation}.`,
				});
			}
			return NextResponse.json(result);
		}

		// Use bible-api.com to fetch actual KJV verse text
		const encoded = encodeURIComponent(reference.replace(/\s*KJV$/i, ""));
		const apiRes = await fetch(
			`https://bible-api.com/${encoded}?translation=kjv`,
			{ next: { revalidate: 86400 } } // Cache for 24h
		);

		if (!apiRes.ok) {
			return NextResponse.json({
				verses: [],
				reference,
				error: "Verse not found in KJV.",
			});
		}

		const data: unknown = await apiRes.json();
		if (!isRecord(data)) {
			throw new Error("Bible API returned an invalid response.");
		}

		const verses = (Array.isArray(data.verses) ? data.verses : []).flatMap((verse) => {
			if (!isRecord(verse)) return [];

			return [{
				book: typeof verse.book_name === "string" ? verse.book_name : "",
				chapter: typeof verse.chapter === "number" ? verse.chapter : 0,
				verse: typeof verse.verse === "number" ? verse.verse : 0,
				text: typeof verse.text === "string" ? verse.text.trim() : "",
			}];
		});

		return NextResponse.json({
			reference: typeof data.reference === "string" ? data.reference : reference,
			text: typeof data.text === "string" ? data.text.trim() : "",
			verses,
			translation:
				typeof data.translation_name === "string"
					? data.translation_name
					: "King James Version",
		});
	} catch (error) {
		console.error("Error in get-verse API:", error);
		return NextResponse.json(
			{ error: "Failed to retrieve verse." },
			{ status: 500 }
		);
	}
}
