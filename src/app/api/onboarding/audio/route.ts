import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { ANALYTICS_EVENTS, platformFromHeaders } from "@/lib/analytics/events";
import { captureServerEvent } from "@/lib/analytics/server";
import { isOnboardingStep } from "@/lib/onboarding-rules";
import { requestOnboardingVoice } from "@/lib/onboarding-voice";

// Narrating a long reply can take a while on a cold model.
export const maxDuration = 60;

/**
 * Voice mode for the welcome conversation. Body `{ messageId }` (one of
 * SureWord's messages in this account's welcome) or `{ step }` (a card's
 * scripted question). Answers either `{ status: "ready", streamUrl }`, to
 * play through our own origin, or `{ status: "device", text, reason }`, which
 * every client speaks with its free on-device voice. See
 * `src/lib/onboarding-voice.ts` for the cost rules.
 */
export async function POST(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const body: unknown = await req.json().catch(() => null);
		const data = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
		const messageId = typeof data.messageId === "string" && data.messageId.length <= 200 ? data.messageId : undefined;
		const step = isOnboardingStep(data.step) ? data.step : undefined;
		if (!messageId === !step) {
			return NextResponse.json({ error: "Send exactly one of messageId or step." }, { status: 400 });
		}
		const answer = await requestOnboardingVoice(userId, messageId ? { messageId } : { step });
		if (!answer) return NextResponse.json({ error: "There is nothing to read aloud here." }, { status: 404 });
		captureServerEvent({
			userId,
			event: ANALYTICS_EVENTS.onboardingVoice,
			platform: platformFromHeaders(req.headers),
			properties: {
				source: answer.status === "ready" ? answer.source : "device",
				...(answer.status === "device" ? { reason: answer.reason } : {}),
				characters: answer.characters,
				kind: step ? "step" : "message",
			},
		});
		return NextResponse.json(answer, { headers: { "Cache-Control": "private, no-store" } });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/onboarding/audio] failed", error);
		return NextResponse.json({ error: "Could not prepare that to be read aloud." }, { status: 500 });
	}
}
