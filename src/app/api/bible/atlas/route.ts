import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { getEntity, searchAtlas, whoIsIn } from "@/lib/bible/atlas";

/** Enough for a search list without turning into a directory dump. */
const MAX_RESULTS = 25;

/**
 * The atlas lookup endpoint, in three modes:
 *
 *   ?q=moses                    - ranked people/places/events
 *   ?id=moses                   - one entity in full, with related and events
 *   ?book=6&chapter=2           - who and where a chapter is about
 *
 * Read-only over bundled data, so it needs nothing but a signed-in caller.
 * The Android app reads the same JSON locally and never calls this; web does.
 */
export async function GET(req: Request): Promise<Response> {
	try {
		await getAuthUserId();

		const params = new URL(req.url).searchParams;

		const id = params.get("id")?.trim();
		if (id) {
			const entity = await getEntity(id);
			if (!entity) {
				return NextResponse.json({ error: "No such person or place." }, { status: 404 });
			}
			return NextResponse.json({ entity });
		}

		const book = Number.parseInt(params.get("book") ?? "", 10);
		const chapter = Number.parseInt(params.get("chapter") ?? "", 10);
		if (Number.isInteger(book) && Number.isInteger(chapter)) {
			if (book < 1 || book > 66 || chapter < 1) {
				return NextResponse.json({ error: "That is not a chapter of the Bible." }, { status: 400 });
			}
			return NextResponse.json(await whoIsIn(book, chapter));
		}

		const query = params.get("q")?.trim() ?? "";
		if (!query) return NextResponse.json({ query: "", results: [] });

		const requested = Number.parseInt(params.get("limit") ?? "", 10);
		const limit = Number.isInteger(requested)
			? Math.min(Math.max(requested, 1), MAX_RESULTS)
			: 10;

		return NextResponse.json({ query, results: await searchAtlas(query, limit) });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/bible/atlas] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
