import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { ATLAS_ERAS, getTimeline } from "@/lib/bible/atlas";
import { bookByOrder } from "@/lib/bible/books";

function parseIntegerParam(params: URLSearchParams, name: string): number | null | undefined {
	const raw = params.get(name);
	if (raw === null) return undefined;
	if (!/^\d+$/.test(raw.trim())) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

/**
 * The timeline, whole or narrowed:
 *
 *   /api/bible/atlas/timeline
 *   /api/bible/atlas/timeline?era=Life%20of%20Christ
 *   /api/bible/atlas/timeline?book=6&chapter=6
 *   /api/bible/atlas/timeline?personId=moses
 *
 * `allEras` is always the full ordered list, so the era chips can be rendered
 * before any filtering has happened.
 */
export async function GET(req: Request): Promise<Response> {
	try {
		await getAuthUserId();

		const params = new URL(req.url).searchParams;

		const era = params.get("era")?.trim() || undefined;
		if (era && !(ATLAS_ERAS as readonly string[]).includes(era)) {
			return NextResponse.json({ error: `Unknown era: ${era}` }, { status: 400 });
		}

		const bookParam = parseIntegerParam(params, "book");
		const chapterParam = parseIntegerParam(params, "chapter");
		if (bookParam === null || chapterParam === null) {
			return NextResponse.json({ error: "That is not a chapter of the Bible." }, { status: 400 });
		}
		if (chapterParam !== undefined && bookParam === undefined) {
			return NextResponse.json({ error: "A chapter requires a book." }, { status: 400 });
		}
		const book = bookParam;
		const chapter = chapterParam;
		if (book !== undefined) {
			const bookMeta = bookByOrder(book);
			if (!bookMeta) {
				return NextResponse.json({ error: "That is not a book of the Bible." }, { status: 400 });
			}
			if (chapter !== undefined && (chapter < 1 || chapter > bookMeta.chapters)) {
				return NextResponse.json({ error: "That is not a chapter of the Bible." }, { status: 400 });
			}
		}

		const personId = params.get("personId")?.trim() || undefined;

		const timeline = await getTimeline({ era, book, chapter, personId });
		return NextResponse.json({ allEras: ATLAS_ERAS, ...timeline });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/bible/atlas/timeline] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
