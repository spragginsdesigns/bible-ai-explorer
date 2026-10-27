import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { placesInVerses } from "@/lib/beta/atlas/atlas";

/**
 * GET /api/beta/atlas/verse?book=44&chapter=19&verse=1&end=3 (LC-17655,
 * docs/beta/atlas.md): the atlas places those KJV verses name, for the
 * reader's founders-only "In the atlas" row. Founders only; bundled text.
 */
export const dynamic = "force-dynamic";

function whole(value: string | null, max: number): number | null {
	if (value === null || !/^\d{1,3}$/.test(value)) return null;
	const n = Number(value);
	return n >= 1 && n <= max ? n : null;
}

export async function GET(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;

	const params = new URL(req.url).searchParams;
	const book = whole(params.get("book"), 66);
	const chapter = whole(params.get("chapter"), 150);
	const verse = whole(params.get("verse"), 176);
	const end = params.get("end") === null ? verse : whole(params.get("end"), 176);
	if (!book || !chapter || !verse || !end || end < verse) {
		return NextResponse.json({ error: "Give a book, chapter and verse." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
	}
	const places = await placesInVerses(book, chapter, verse, end);
	if (!places) return NextResponse.json({ error: "Not found" }, { status: 404, headers: BETA_PRIVATE_HEADERS });
	return NextResponse.json({ places }, { headers: BETA_PRIVATE_HEADERS });
}
