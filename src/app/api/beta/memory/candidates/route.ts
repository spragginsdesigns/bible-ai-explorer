import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { MemoryInputError, memoryCandidates, previewPassage, rangeFromReference } from "@/lib/beta/memory/memory";

/**
 * GET /api/beta/memory/candidates: what "Make cards" previews before anything
 * is added (docs/beta/memory.md).
 *
 * - No query: verses and passages from the founder's own highlights, studies,
 *   notes, other beta modules and chats that are not cards yet, each with the
 *   record it came from. Read only; nothing is generated.
 * - `?reference=Ephesians 2:8-9`: that verse or passage in their translation,
 *   with the verses already in the deck marked.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const reference = new URL(req.url).searchParams.get("reference");
		if (reference !== null) {
			if (reference.length > 80) throw new MemoryInputError("That reference is too long.");
			return NextResponse.json({ passage: await previewPassage(gate.userId, rangeFromReference(reference)) }, { headers: BETA_PRIVATE_HEADERS });
		}
		return NextResponse.json({ candidates: await memoryCandidates(gate.userId) }, { headers: BETA_PRIVATE_HEADERS });
	} catch (error) {
		if (error instanceof MemoryInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status, headers: BETA_PRIVATE_HEADERS });
		}
		console.error("[api/beta/memory/candidates] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: BETA_PRIVATE_HEADERS });
	}
}
