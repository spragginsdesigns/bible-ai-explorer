import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { memorySession } from "@/lib/beta/memory/memory";

/**
 * GET /api/beta/memory/session: today's review session (docs/beta/memory.md).
 * Due units, at most ten, with each card's text, revision and schedule so the
 * browser can review through Learn a verse's own `/api/learn/[id]/review`.
 */
export const dynamic = "force-dynamic";

export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return NextResponse.json(await memorySession(gate.userId), { headers: BETA_PRIVATE_HEADERS });
	} catch (error) {
		console.error("[api/beta/memory/session] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: BETA_PRIVATE_HEADERS });
	}
}
