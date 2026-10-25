import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getAuthUser } from "@/lib/auth";
import { ANALYTICS_EVENTS, platformFromHeaders } from "@/lib/analytics/events";
import { captureServerEvent } from "@/lib/analytics/server";
import { startOnboarding, type OnboardingStartMode } from "@/lib/onboarding";
import { warmScriptedVoice } from "@/lib/onboarding-voice";

/**
 * Open the "Walk with me" welcome conversation (docs/onboarding/PLAN.md).
 *
 * Body `{ mode }`: "auto" (default) is what every client calls after sign-in
 * and the consent sheet, and only a brand-new account gets a welcome from it;
 * "manual" is Settings → Walk me through SureWord, for anyone. Idempotent:
 * calling it again returns the same conversation.
 *
 * Answers `{ status: "active", conversationId, created }`, `{ status: "done" }`
 * or `{ status: "not_eligible" }`. Only "active" opens anything.
 */
export async function POST(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const body: unknown = await req.json().catch(() => ({}));
		const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>).mode : undefined;
		if (raw !== undefined && raw !== "auto" && raw !== "manual") {
			return NextResponse.json({ error: 'mode must be "auto" or "manual"' }, { status: 400 });
		}
		const mode: OnboardingStartMode = raw === "manual" ? "manual" : "auto";
		const result = await startOnboarding(userId, mode);
		if (result.status === "active") {
			captureServerEvent({
				userId,
				event: ANALYTICS_EVENTS.onboardingStarted,
				platform: platformFromHeaders(req.headers),
				properties: { mode, created: result.created },
			});
			// The lines everyone hears, narrated once and shared, before anyone asks.
			if (result.created) waitUntil(warmScriptedVoice());
		}
		return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/onboarding/start] failed", error);
		return NextResponse.json({ error: "Could not open the welcome. Try again." }, { status: 500 });
	}
}
