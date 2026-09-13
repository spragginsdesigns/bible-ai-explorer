import { readerVerseSegments, readerSectionHeadings } from "@/lib/bible/redLetters";
import { NextResponse } from "next/server";
import { loadBsbChapter } from "@/lib/bible/bsb";
import { getKjvChapter } from "@/lib/bible/kjv";
import { bookByOrder } from "@/lib/bible/books";
import source from "@/data/bsb-source.json";

/** Our public, cacheable Bible API. No upstream API call or paid text license. */
export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const translation = params.get("translation") ?? "BSB";
	const book = Number(params.get("book"));
	const chapter = Number(params.get("chapter"));
	const selectedBook = bookByOrder(book);
	if (
		!["KJV", "BSB"].includes(translation) ||
        !/^\d+$/.test(params.get("book") ?? "") ||
        !/^\d+$/.test(params.get("chapter") ?? "") ||
		!Number.isInteger(book) ||
		!selectedBook ||
		!Number.isInteger(chapter) ||
		chapter < 1 ||
		chapter > selectedBook.chapters
	) {
		return NextResponse.json(
			{ error: "Use translation=BSB or KJV, book=1–66, and a valid chapter." },
			{ status: 400 },
		);
	}
	const verses =
		translation === "BSB"
			? await loadBsbChapter(book, chapter)
			: (await getKjvChapter(book, chapter)).map((text, index) => ({
					number: index + 1,
					text,
					headings: readerSectionHeadings("KJV", book, chapter, index + 1),
					paragraphStart: true,
					segments: readerVerseSegments(text, "KJV", book, chapter, index + 1),
				}));
	return NextResponse.json(
		{
			translation,
			book,
			chapter,
			reference: `${selectedBook.name} ${chapter}`,
			copyright:
				translation === "BSB"
					? "Berean Standard Bible · Public domain · BSB Publishing"
					: "King James Version · Public domain",
			source: translation === "BSB" ? source : { speech: "https://ebible.org/eng-kjv/", editorialHeadings: "https://berean.bible/downloads.htm" },
			verses,
		},
		{ headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" } },
	);
}
