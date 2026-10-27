import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { getJourneyPassages } from "@/lib/beta/atlas/atlas";

/**
 * GET /api/beta/atlas/journey?id=<journey> (LC-17655, docs/beta/atlas.md):
 * the KJV verses for every stop of one journey, fetched once when the journey
 * is chosen so playing it never waits. Founders only; bundled text.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;

	const id = new URL(req.url).searchParams.get("id") ?? "";
	if (!/^[a-z0-9-]{1,40}$/.test(id)) {
		return NextResponse.json({ error: "Ask for one journey by its id." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
	}
	const passages = await getJourneyPassages(id);
	if (!passages) return NextResponse.json({ error: "Not found" }, { status: 404, headers: BETA_PRIVATE_HEADERS });
	return NextResponse.json(passages, { headers: BETA_PRIVATE_HEADERS });
}
