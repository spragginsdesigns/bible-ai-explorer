import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { memoryOverview } from "@/lib/beta/memory/memory";

/**
 * GET /api/beta/memory: Scripture Memory's overview (LC-17651,
 * docs/beta/memory.md). The founder's Learn a verse deck as known, learning
 * and due, by book and by verse, plus how many units are due today.
 */
export const dynamic = "force-dynamic";

export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return NextResponse.json(await memoryOverview(gate.userId), { headers: BETA_PRIVATE_HEADERS });
	} catch (error) {
		console.error("[api/beta/memory] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: BETA_PRIVATE_HEADERS });
	}
}
