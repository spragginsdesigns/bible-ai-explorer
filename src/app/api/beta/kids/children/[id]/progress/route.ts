import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { findKidsAdventure } from "@/lib/beta/kids/adventures";
import { awardToChild } from "@/lib/beta/kids/children";
import { isKidsAward } from "@/lib/beta/kids/kids-rules";

/**
 * POST { adventure, award: "star" | "verse" } -> { child }
 *
 * Kids mode's only write: a star when a child finishes an adventure's
 * questions, or a mark when they learn its verse. Only an adventure id from
 * the checked-in catalog is ever stored, never anything a child typed.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const { id } = await params;
	const body = (await request.json().catch(() => null)) as { adventure?: unknown; award?: unknown } | null;
	const adventure = typeof body?.adventure === "string" ? findKidsAdventure(body.adventure) : null;
	const award = body?.award;
	if (!adventure || !isKidsAward(award)) {
		return NextResponse.json({ error: "Send an adventure and an award of star or verse." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
	}
	const child = await awardToChild(gate.userId, id, adventure.id, award);
	if (!child) return betaNotFound();
	return NextResponse.json({ child }, { headers: BETA_PRIVATE_HEADERS });
}
