import { NextResponse } from "next/server";
import { z } from "zod";
import { captureServerEvent, flushAnalytics } from "@/lib/analytics/server";
import { ANALYTICS_EVENTS, platformFromHeaders } from "@/lib/analytics/events";
import { getAuthUser } from "@/lib/auth";
import {
	getOrCreateDailyCrossAudio,
	readDailyCrossAudio,
	type DailyCrossAudio,
} from "@/lib/daily-cross-audio";

// POST does a model call plus a full ElevenLabs narration of a several-minute
// script, then a blob upload. 30-60s is normal.
export const maxDuration = 300;

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

/** GET reads status. POST is the only entry point that can buy narration. */

function toResponse(audio: DailyCrossAudio) {
	return NextResponse.json(
		{
			status: audio.status,
			url: audio.url,
			streamUrl: audio.streamUrl,
			title: audio.title,
			script: audio.script,
			durationSec: audio.durationSec,
			generatedAt: audio.generatedAt,
			plan: audio.plan,
		},
		{ headers: PRIVATE_NO_STORE }
	);
}

/**
 * The state of today's spoken devotional. Cheap and side-effect free: this is
 * read performed on opening the screen, then polled only while a requested
 * generation is running.
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
export async function GET(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const audio = await readDailyCrossAudio(userId);
		// "pending" is the poll itself, every few seconds until the narration
		// lands, so counting it would drown the event in one user's waiting.
		// Every other status is where a poll comes to rest, once.
		if (audio.status !== "pending") {
			await captureListen(userId, req, audio, false);
		}
		return toResponse(audio);
	} catch (error) {
		return errorResponse(error);
	}
}

/**
 * One row per devotional a reader actually reached, whichever tier they are on:
 * "locked" and "unavailable" are the whole point of measuring this, because
 * they are the taps that got nothing.
 */
async function captureListen(
	userId: string,
	req: Request,
	audio: DailyCrossAudio,
	manual: boolean
): Promise<void> {
	captureServerEvent({
		userId,
		event: ANALYTICS_EVENTS.listenRequested,
		platform: platformFromHeaders(req.headers),
		properties: { status: audio.status, plan: audio.plan, manual },
	});
	await flushAnalytics();
}

/** Empty bodies remain valid for older clients requesting the default voice. */
export async function POST(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const raw = await req.text();
		let body: unknown = {};
		try { body = raw.trim() ? JSON.parse(raw) : {}; } catch {
			return NextResponse.json({ error: "Invalid audio options." }, { status: 400, headers: PRIVATE_NO_STORE });
		}
		const parsed = z.object({ voiceId: z.string().trim().min(1).max(100).optional(), style: z.enum(["calm", "natural", "expressive"]).optional() }).strict().safeParse(body);
		if (!parsed.success) return NextResponse.json({ error: "Invalid audio options." }, { status: 400, headers: PRIVATE_NO_STORE });
		const audio = await getOrCreateDailyCrossAudio(userId, parsed.data);
		await captureListen(userId, req, audio, true);
		return toResponse(audio);
	} catch (error) {
		return errorResponse(error);
	}
}

function errorResponse(error: unknown): Response {
	if (error instanceof Response) return error;
	console.error("Error in verse-of-day/audio route:", error);
	return NextResponse.json(
		{ error: "Today's devotional audio could not be prepared." },
		{ status: 500, headers: PRIVATE_NO_STORE }
	);
}
