import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { bookByOrder } from "@/lib/bible/books";
import {
	ATLAS_ERAS,
	getEntity,
	listEntities,
	searchAtlasResults as searchAtlasResult,
	whoIsIn,
} from "@/lib/bible/atlas";

/** Enough for a search list without turning into a directory dump. */
const MAX_RESULTS = 25;
const DEFAULT_SEARCH_LIMIT = 12;
const DEFAULT_ENTITY_LIMIT = 50;
const MAX_ENTITY_LIMIT = 100;

function parseIntegerParam(params: URLSearchParams, name: string): number | null | undefined {
	const raw = params.get(name);
	if (raw === null) return undefined;
	if (!/^\d+$/.test(raw.trim())) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

function invalidChapterResponse(): Response {
	return NextResponse.json({ error: "That is not a chapter of the Bible." }, { status: 400 });
}

/**
 * The atlas endpoint serves entity detail, entity listings, search, and chapter
 * context. Event detail has its own route so callers can fetch it directly.
 *
 *   ?q=moses                    - ranked people/places/events
 *   ?id=moses                   - one entity in full, with related and events
 *   ?kind=person&era=...        - paginated people or places
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

		const book = parseIntegerParam(params, "book");
		const chapter = parseIntegerParam(params, "chapter");
		if (book !== undefined || chapter !== undefined) {
			if (book === null || chapter === null || book === undefined || chapter === undefined) {
				return invalidChapterResponse();
			}
			const bookMeta = bookByOrder(book);
			if (!bookMeta || chapter < 1 || chapter > bookMeta.chapters) {
				return invalidChapterResponse();
			}
			return NextResponse.json(await whoIsIn(book, chapter));
		}

		const kindParam = params.get("kind")?.trim();
		if (kindParam) {
			if (kindParam !== "person" && kindParam !== "place") {
				return NextResponse.json({ error: "kind must be person or place." }, { status: 400 });
			}
			const era = params.get("era")?.trim() || undefined;
			if (era && !(ATLAS_ERAS as readonly string[]).includes(era)) {
				return NextResponse.json({ error: `Unknown era: ${era}` }, { status: 400 });
			}
			const requested = parseIntegerParam(params, "limit");
			const limit = Math.min(
				Math.max(requested === null || requested === undefined ? DEFAULT_ENTITY_LIMIT : requested, 1),
				MAX_ENTITY_LIMIT
			);
			const cursor = params.get("cursor")?.trim() || undefined;
			const listing = await listEntities({
				kind: kindParam as "person" | "place",
				era,
				cursor,
				limit,
			});
			return NextResponse.json({
				kind: kindParam,
				results: listing.items,
				nextCursor: listing.nextCursor ?? null,
			});
		}

		const query = params.get("q")?.trim() ?? "";
		if (!query) return NextResponse.json({ query: "", results: [] });

		const requested = parseIntegerParam(params, "limit");
		const limit = requested === null || requested === undefined
			? DEFAULT_SEARCH_LIMIT
			: Math.min(Math.max(requested, 1), MAX_RESULTS);

		return NextResponse.json({ ...(await searchAtlasResult(query, limit)), query });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/bible/atlas] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
