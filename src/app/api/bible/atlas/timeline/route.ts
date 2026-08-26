import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { ATLAS_ERAS, getTimeline } from "@/lib/bible/atlas";

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

		const bookParam = Number.parseInt(params.get("book") ?? "", 10);
		const chapterParam = Number.parseInt(params.get("chapter") ?? "", 10);
		const book = Number.isInteger(bookParam) ? bookParam : undefined;
		if (book !== undefined && (book < 1 || book > 66)) {
			return NextResponse.json({ error: "That is not a book of the Bible." }, { status: 400 });
		}
		const chapter = Number.isInteger(chapterParam) && chapterParam > 0 ? chapterParam : undefined;

		const personId = params.get("personId")?.trim() || undefined;

		const timeline = await getTimeline({ era, book, chapter, personId });
		return NextResponse.json({ allEras: ATLAS_ERAS, ...timeline });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/bible/atlas/timeline] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
