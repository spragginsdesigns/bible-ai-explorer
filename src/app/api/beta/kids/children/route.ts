import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { createChild, listChildren } from "@/lib/beta/kids/children";

/**
 * SureWord Kids' child profiles (docs/beta/kids.md), founders only.
 *
 * GET  -> { children: KidsChild[] }
 * POST { name, ageBand } -> { child } (201)
 *
 * A profile is a first name or nickname and an age band; nothing else about a
 * child is accepted, and nothing here reaches a model.
 */
export const dynamic = "force-dynamic";

export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	return NextResponse.json({ children: await listChildren(gate.userId) }, { headers: BETA_PRIVATE_HEADERS });
}

export async function POST(request: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const body = (await request.json().catch(() => null)) as { name?: unknown; ageBand?: unknown } | null;
	if (!body || typeof body !== "object") {
		return NextResponse.json({ error: "Send a name and an age band." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
	}
	// The profile hangs off the parent's User row, which a brand-new account may not have yet.
	await getAuthUser();
	const result = await createChild(gate.userId, { name: body.name, ageBand: body.ageBand });
	if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: BETA_PRIVATE_HEADERS });
	return NextResponse.json({ child: result.child }, { status: 201, headers: BETA_PRIVATE_HEADERS });
}
