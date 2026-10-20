import { NextResponse } from "next/server";
import { getChapterConnections } from "@/lib/bible/connections";

export const maxDuration = 15;

// Same class as /api/bible/crossrefs: bundled reference data, no user state,
// a pure function of the query string, so it is public and cached hard.
const cacheHeaders = {
	"Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
};

/** Digits only, so "1.5", "-1" and "five" are rejected rather than coerced. */
function positiveInteger(raw: string | null): number | null {
	if (raw === null || !/^\d+$/.test(raw.trim())) return null;
	const value = Number(raw.trim());
	return value >= 1 ? value : null;
}

/**
 * Every ranked cross-reference out of one chapter, with each destination's
 * place around the Connections ring (docs/FEATURES.md -> "Connections map").
 * `?book=45&chapter=8`, book by canonical order.
 */
export async function GET(req: Request): Promise<Response> {
	try {
		const params = new URL(req.url).searchParams;
		const order = positiveInteger(params.get("book"));
		const chapter = positiveInteger(params.get("chapter"));
		if (order === null || chapter === null) {
			return NextResponse.json({ error: "invalid_reference" }, { status: 400 });
		}
		const data = await getChapterConnections(order, chapter);
		if (!data) return NextResponse.json({ error: "invalid_reference" }, { status: 400 });
		return NextResponse.json(data, { headers: cacheHeaders });
	} catch (error) {
		console.error("[api/bible/connections] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
