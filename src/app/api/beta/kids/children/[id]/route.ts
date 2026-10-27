import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { deleteChild, updateChild } from "@/lib/beta/kids/children";

/**
 * One child profile (docs/beta/kids.md), founders only.
 *
 * PATCH { name?, ageBand? } -> { child }
 * DELETE -> { deleted: true }, removing the profile and all of its progress
 *
 * Another parent's child id answers 404, the same as an id that never existed.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const { id } = await params;
	const body = (await request.json().catch(() => null)) as { name?: unknown; ageBand?: unknown } | null;
	if (!body || typeof body !== "object") {
		return NextResponse.json({ error: "Send a name or an age band." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
	}
	const result = await updateChild(gate.userId, id, { name: body.name, ageBand: body.ageBand });
	if (!result.ok) return result.status === 404 ? betaNotFound() : NextResponse.json({ error: result.error }, { status: result.status, headers: BETA_PRIVATE_HEADERS });
	return NextResponse.json({ child: result.child }, { headers: BETA_PRIVATE_HEADERS });
}

export async function DELETE(_request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const { id } = await params;
	if (!(await deleteChild(gate.userId, id))) return betaNotFound();
	return NextResponse.json({ deleted: true }, { headers: BETA_PRIVATE_HEADERS });
}
