import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { getAuthUser } from "@/lib/auth";
import { BetaStoreError } from "@/lib/beta/store";
import { listVoiceSessions, saveVoiceSession, VoiceSessionInputError } from "@/lib/beta/voice/sessions";

/**
 * GET /api/beta/voice/sessions: the founder's recent Voice Study conversations.
 * POST /api/beta/voice/sessions { id?, turns, startedAt, endedAt, usage }:
 * keeps a conversation as a BetaItem (module "voice"), or updates the one
 * with `id`. See docs/beta/voice.md.
 */
export const dynamic = "force-dynamic";

const MAX_BODY = 512 * 1024;

export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const sessions = await listVoiceSessions(gate.userId);
	return NextResponse.json({ sessions }, { headers: BETA_PRIVATE_HEADERS });
}

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const text = await req.text();
	let body: Record<string, unknown> | null = null;
	try {
		const parsed: unknown = text.length <= MAX_BODY ? JSON.parse(text) : null;
		body = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
	} catch {
		body = null;
	}
	if (!body) return NextResponse.json({ error: "Send the conversation as JSON." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
	// The store's rows hang off the User row, which a first visit may not have made yet.
	await getAuthUser();
	try {
		const session = await saveVoiceSession(gate.userId, { id: body.id, turns: body.turns, startedAt: body.startedAt, endedAt: body.endedAt, usage: body.usage });
		if (!session) return NextResponse.json({ error: "Not found" }, { status: 404, headers: BETA_PRIVATE_HEADERS });
		return NextResponse.json({ session }, { status: body.id ? 200 : 201, headers: BETA_PRIVATE_HEADERS });
	} catch (error) {
		if (error instanceof VoiceSessionInputError || error instanceof BetaStoreError) {
			return NextResponse.json({ error: error.message }, { status: 400, headers: BETA_PRIVATE_HEADERS });
		}
		throw error;
	}
}
