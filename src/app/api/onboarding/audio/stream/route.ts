import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
	describeOnboardingVoiceStream,
	openOnboardingVoiceStream,
	checkedOnboardingStreamPath,
} from "@/lib/onboarding-voice";

/**
 * A welcome narration, streamed through our own origin for the same reason
 * the Listen stream exists (Chrome's media loader will not play a presigned
 * private-blob URL; see verse-of-day/audio/stream). `key` comes from the
 * `streamUrl` POST /api/onboarding/audio returned: `shared-…` for the lines
 * every account hears, `mine-…` for this caller's own replies, so nobody can
 * reach another account's audio.
 */
export const maxDuration = 60;

async function pathnameFor(request: Request, userId: string): Promise<string | null> {
	const query = new URL(request.url).searchParams;
	return checkedOnboardingStreamPath(userId, query.get("key"), query.get("messageId"));
}

export async function GET(request: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const pathname = await pathnameFor(request, userId);
		if (!pathname) return NextResponse.json({ error: "Unknown audio." }, { status: 404 });
		const audio = await openOnboardingVoiceStream(pathname, request.headers.get("range"));
		if (!audio) return NextResponse.json({ error: "Unknown audio." }, { status: 404 });
		return new Response(audio.body, { status: audio.status, headers: audio.headers });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/onboarding/audio/stream] GET failed", error);
		return NextResponse.json({ error: "That audio could not be played." }, { status: 500 });
	}
}

export async function HEAD(request: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const pathname = await pathnameFor(request, userId);
		const init = pathname ? await describeOnboardingVoiceStream(pathname) : null;
		if (!init) return new Response(null, { status: 404 });
		return new Response(null, { status: init.status, headers: init.headers });
	} catch (error) {
		return new Response(null, { status: error instanceof Response ? error.status : 500 });
	}
}
