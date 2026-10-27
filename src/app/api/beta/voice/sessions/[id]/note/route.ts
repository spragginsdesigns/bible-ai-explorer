import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { getAuthUser } from "@/lib/auth";
import { saveVoiceSessionNote } from "@/lib/beta/voice/sessions";

/**
 * POST /api/beta/voice/sessions/[id]/note: saves the conversation as a Note
 * (the transcript plus every passage it cited or read, quoted from the KJV).
 * Saving again after more conversation appends only the new part.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	await getAuthUser();
	const note = await saveVoiceSessionNote(gate.userId, (await params).id);
	if (!note) return betaNotFound();
	return NextResponse.json({ note }, { status: note.created ? 201 : 200, headers: BETA_PRIVATE_HEADERS });
}
