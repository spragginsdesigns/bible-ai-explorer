import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
	describeDailyCrossAudioStream,
	openDailyCrossAudioStream,
} from "@/lib/daily-cross-audio";

/**
 * Today's spoken devotional, streamed through our own origin.
 *
 * WHY THIS ROUTE EXISTS (verified in production, 2026-08-26). The narration
 * generates fine - ElevenLabs to a private Vercel Blob, `audioStatus: "ready"`
 * - but **Chrome's media loader never loads the presigned private-blob URL**.
 * On an `<audio>` element the URL sits at `readyState: 0`, `networkState: 2`,
 * no `error` event, forever; open the same URL in a tab and Chrome's own
 * player does exactly the same thing. Meanwhile `fetch` and `curl` of that URL
 * both succeed (200/206, `audio/mpeg`, `accept-ranges: bytes`,
 * `content-disposition: inline`), and a `blob:` URL built from the fetched
 * bytes plays instantly at the full 225s. HEAD on the presigned URL answers
 * 403, because the signature is bound to the method. So the MP3 is valid and
 * the signature is valid; Chrome's media loader and the private-blob host
 * simply do not get along.
 *
 * Proxying is the fix: same origin, ordinary session auth, a real HEAD, and
 * `Range` forwarded both ways so seeking still works. The signed blob URL is
 * still returned by the sibling route as `url` (it fetches fine), but no
 * client should hand it to a media element.
 */

// Streaming a several-minute MP3 through the function outlives the default.
export const maxDuration = 60;

const NOT_FOUND = { error: "There is no devotional audio for today yet." };

export async function GET(request: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const audio = await openDailyCrossAudioStream(userId, request.headers.get("range"));
		if (!audio) return NextResponse.json(NOT_FOUND, { status: 404 });
		return new Response(audio.body, { status: audio.status, headers: audio.headers });
	} catch (error) {
		return errorResponse(error);
	}
}

/**
 * Some players probe with HEAD before opening the stream - the one thing the
 * presigned blob URL could never answer, since its signature only covers GET.
 */
export async function HEAD(): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const audio = await describeDailyCrossAudioStream(userId);
		if (!audio) return new Response(null, { status: 404 });
		return new Response(null, { status: audio.status, headers: audio.headers });
	} catch (error) {
		const failure = errorResponse(error);
		// A HEAD response must carry no body, error or not.
		return new Response(null, { status: failure.status, headers: failure.headers });
	}
}

function errorResponse(error: unknown): Response {
	if (error instanceof Response) return error;
	console.error("Error in verse-of-day/audio/stream route:", error);
	return NextResponse.json(
		{ error: "Today's devotional audio could not be played." },
		{ status: 500 }
	);
}
