import { NextResponse } from "next/server";
import { getConnectionsOverview } from "@/lib/bible/connections";

export const maxDuration = 30;

// Built from the bundled data alone, so it only changes with a deploy.
const cacheHeaders = {
	"Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
};

/**
 * The whole cross-reference set folded into weighted bin pairs: the faint
 * weave drawn behind every chapter on the Connections ring.
 */
export async function GET(): Promise<Response> {
	try {
		return NextResponse.json(await getConnectionsOverview(), { headers: cacheHeaders });
	} catch (error) {
		console.error("[api/bible/connections/overview] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
