import { NextResponse } from "next/server";
import { getAuthUser, getAuthUserId } from "@/lib/auth";
import { clearUserChurch, loadUserChurch, setUserChurch } from "@/lib/church";
import { isPlacesConfigured } from "@/lib/church-rules";
import { PlaceNotFoundError } from "@/lib/google-places";

/**
 * The user's home church (Settings -> My church).
 *
 * `status` is "unavailable" when this deployment has no Google Places key: the
 * clients then render no My church section at all, rather than a picker that can
 * only ever fail. It is answered before any database work, because the answer is
 * the same for every user.
 */

// PUT fetches a place, the church's website, up to three more pages, and runs a
// model extraction over them. Thirty seconds is not always enough.
export const maxDuration = 60;

const MAX_PLACE_ID_LENGTH = 200;

export async function GET() {
	try {
		const userId = await getAuthUserId();
		if (!isPlacesConfigured(process.env.GOOGLE_PLACES_API_KEY)) {
			return NextResponse.json({ status: "unavailable" });
		}
		return NextResponse.json({ status: "ok", church: await loadUserChurch(userId) });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/church] GET failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/** Pick a church. Replaces whatever was set before; one church per user. */
export async function PUT(req: Request) {
	try {
		const userId = await getAuthUser();
		if (!isPlacesConfigured(process.env.GOOGLE_PLACES_API_KEY)) {
			return NextResponse.json({ status: "unavailable" });
		}

		const body: unknown = await req.json().catch(() => null);
		const placeId = typeof body === "object" && body !== null ? (body as { placeId?: unknown }).placeId : null;
		if (typeof placeId !== "string" || !placeId.trim() || placeId.length > MAX_PLACE_ID_LENGTH) {
			return NextResponse.json({ error: "placeId must be a non-empty string" }, { status: 400 });
		}

		return NextResponse.json({ status: "ok", church: await setUserChurch(userId, placeId.trim()) });
	} catch (err) {
		if (err instanceof Response) return err;
		if (err instanceof PlaceNotFoundError) {
			return NextResponse.json({ error: "That church could not be found." }, { status: 404 });
		}
		console.error("[api/church] PUT failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/** Forget the user's church. */
export async function DELETE() {
	try {
		const userId = await getAuthUser();
		await clearUserChurch(userId);
		return NextResponse.json({ status: "ok", church: null });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/church] DELETE failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
