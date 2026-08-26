import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
	getOrCreateDailyCrossAudio,
	readDailyCrossAudio,
	type DailyCrossAudio,
} from "@/lib/daily-cross-audio";

// POST does a model call plus a full ElevenLabs narration of a several-minute
// script, then a blob upload. 30-60s is normal.
export const maxDuration = 120;

/**
 * "Listen" - today's spoken devotional.
 *
 * Audio is generated ONCE PER DAY, WITH the day: every place a cross is stored
 * calls `scheduleDailyCrossAudio`, so a user opening Pick Up Your Cross finds
 * it ready or watches it finish within a minute. GET is what the clients poll;
 * POST survives only as the manual retry behind a failed card, and no client
 * calls it to start a first generation any more.
 *
 * Listen is a SureWord Pro benefit. Free accounts get `status: "locked"`
 * before any database write, model call or ElevenLabs request.
 */

function toResponse(audio: DailyCrossAudio) {
	return NextResponse.json({
		status: audio.status,
		url: audio.url,
		streamUrl: audio.streamUrl,
		title: audio.title,
		script: audio.script,
		durationSec: audio.durationSec,
		generatedAt: audio.generatedAt,
		plan: audio.plan,
	});
}

/**
 * The state of today's spoken devotional. Cheap and side-effect free: this is
 * the ONLY call a client makes to reach a devotional now, polled every few
 * seconds while the scheduled generation is still running.
 *
 * `status` is "unavailable" when this deployment has no ElevenLabs key (the
 * clients then render no Listen card at all), "locked" for a free account (the
 * clients render the Pro card), "none" when the user has no day yet, "pending"
 * while it is being made, "ready" with a signed `url` good for 24 hours, or
 * "failed". `plan` carries the caller's tier alongside it.
 *
 * "ready" also carries `streamUrl`, the same-origin path clients actually play
 * from. `url` fetches fine but Chrome's media loader will not load it - see
 * `stream/route.ts` for the finding and the fix.
 */
export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUser();
		return toResponse(await readDailyCrossAudio(userId));
	} catch (error) {
		return errorResponse(error);
	}
}

/**
 * The manual retry, and nothing else. A devotional that failed to generate
 * leaves a "failed" row and a "Try again" button; this is what that button
 * calls. First generations are scheduled with the day, so no client asks for
 * one here any more.
 *
 * Still safe to call twice: it reuses a ready row and a pending row under
 * three minutes old, so a retry that races the scheduled attempt buys one
 * narration between them, not two.
 */
export async function POST(): Promise<Response> {
	try {
		const userId = await getAuthUser();
		return toResponse(await getOrCreateDailyCrossAudio(userId));
	} catch (error) {
		return errorResponse(error);
	}
}

function errorResponse(error: unknown): Response {
	if (error instanceof Response) return error;
	console.error("Error in verse-of-day/audio route:", error);
	return NextResponse.json(
		{ error: "Today's devotional audio could not be prepared." },
		{ status: 500 }
	);
}
