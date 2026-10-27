import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { getEventCard, getPlaceCard } from "@/lib/beta/atlas/atlas";

/**
 * GET /api/beta/atlas/card?place=<id> | ?event=<id> (LC-17655,
 * docs/beta/atlas.md): one place or event for the atlas card, with its KJV
 * passages from the bundled text. Founders only; read-only bundled data.
 */
export const dynamic = "force-dynamic";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;

	const params = new URL(req.url).searchParams;
	const place = params.get("place");
	const event = params.get("event");
	const id = place ?? event;
	if (!id || (place && event) || id.length > 80 || !ID.test(id)) {
		return NextResponse.json({ error: "Ask for one place or one event by its id." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
	}
	const card = place ? await getPlaceCard(id) : await getEventCard(id);
	if (!card) return NextResponse.json({ error: "Not found" }, { status: 404, headers: BETA_PRIVATE_HEADERS });
	return NextResponse.json({ card }, { headers: BETA_PRIVATE_HEADERS });
}
