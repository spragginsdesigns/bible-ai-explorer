import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { createVoiceCall, isPlausibleOffer } from "@/lib/beta/voice/session";
import { createRateLimiter } from "@/lib/rateLimit";

/**
 * POST /api/beta/voice/call: the browser's WebRTC offer (SDP, as the body) in,
 * the Realtime API's SDP answer out (docs/beta/voice.md). Opening a call is
 * what starts the spend, so it is capped per founder per hour; a conversation
 * itself ends after 30 minutes or 3 quiet ones.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const callsPerHour = createRateLimiter({ limit: 20, windowMs: 60 * 60_000, maxKeys: 50 });

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const offer = await req.text();
	if (!isPlausibleOffer(offer)) {
		return NextResponse.json({ error: "Send the WebRTC offer as the request body." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
	}
	const limit = callsPerHour.check(gate.userId);
	if (!limit.allowed) {
		return NextResponse.json(
			{ error: "That is a lot of conversations in one hour. Try again a little later." },
			{ status: 429, headers: { ...BETA_PRIVATE_HEADERS, "Retry-After": String(limit.retryAfterSeconds) } },
		);
	}
	const result = await createVoiceCall(gate.userId, offer);
	if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: BETA_PRIVATE_HEADERS });
	return new Response(result.answer, { status: 201, headers: { ...BETA_PRIVATE_HEADERS, "Content-Type": "application/sdp" } });
}
