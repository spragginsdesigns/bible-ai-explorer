import { NextResponse } from "next/server";
import { CHURCH_PHOTO_WIDTH_PX, findChurchPhotoName } from "@/lib/church";
import { isPlacesConfigured } from "@/lib/church-rules";
import { resolvePlacePhotoUri } from "@/lib/google-places";

/**
 * A church's Google Places photo, streamed through our own origin.
 *
 * Public on purpose, and keyed only by place id. Google's photo URL carries the
 * API key, so it can never be handed to a client; proxying is what keeps the key
 * on the server. Nothing here is user data - the photo is the same for everyone
 * who picked that church - so there is nothing for a session to protect, and the
 * lookup is deliberately by place id rather than by user.
 *
 * Only place ids some user actually saved are served, so this cannot be used as
 * an open proxy for arbitrary Places media.
 */

// Cached hard: a church photo changes about never, and every byte served from
// the CDN is a Places media call we do not pay for.
const CACHE_CONTROL = "public, max-age=86400, s-maxage=604800";

export async function GET(req: Request) {
	try {
		if (!isPlacesConfigured(process.env.GOOGLE_PLACES_API_KEY)) {
			return NextResponse.json({ error: "Church photos are unavailable." }, { status: 404 });
		}

		const placeId = (new URL(req.url).searchParams.get("placeId") ?? "").trim();
		if (!placeId) {
			return NextResponse.json({ error: "placeId is required" }, { status: 400 });
		}

		const photoName = await findChurchPhotoName(placeId);
		if (!photoName) {
			return NextResponse.json({ error: "No photo for that church." }, { status: 404 });
		}

		const photoUri = await resolvePlacePhotoUri(photoName, CHURCH_PHOTO_WIDTH_PX);
		if (!photoUri) {
			return NextResponse.json({ error: "No photo for that church." }, { status: 404 });
		}

		const upstream = await fetch(photoUri, { signal: AbortSignal.timeout(10_000) });
		if (!upstream.ok || !upstream.body) {
			return NextResponse.json({ error: "No photo for that church." }, { status: 404 });
		}

		return new Response(upstream.body, {
			status: 200,
			headers: {
				"Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
				"Cache-Control": CACHE_CONTROL,
			},
		});
	} catch (err) {
		console.error("[api/church/photo] GET failed", err);
		return NextResponse.json({ error: "That photo could not be loaded." }, { status: 500 });
	}
}
