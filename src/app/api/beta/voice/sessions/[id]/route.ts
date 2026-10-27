import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { deleteVoiceSession, getVoiceSession } from "@/lib/beta/voice/sessions";

/**
 * GET /api/beta/voice/sessions/[id]: one conversation with its transcript.
 * DELETE: forgets it (a Note saved from it stays in Notes). Someone else's id
 * behaves exactly like one that does not exist.
 */
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const session = await getVoiceSession(gate.userId, (await params).id);
	return session ? NextResponse.json({ session }, { headers: BETA_PRIVATE_HEADERS }) : betaNotFound();
}

export async function DELETE(_req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const deleted = await deleteVoiceSession(gate.userId, (await params).id);
	return deleted ? NextResponse.json({ deleted: true }, { headers: BETA_PRIVATE_HEADERS }) : betaNotFound();
}
