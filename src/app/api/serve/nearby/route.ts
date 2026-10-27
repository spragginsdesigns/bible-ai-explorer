import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { isPlacesConfigured } from "@/lib/church-rules";
import { createRateLimiter } from "@/lib/rateLimit";
import { findServePlaces } from "@/lib/serve";
import { cleanLocation, MAX_LOCATION_LENGTH } from "@/lib/serve-rules";

/**
 * Ways to Serve, nearby: food banks, shelters and care homes near a place the
 * reader typed (`?location=Fresno, CA&kind=food`). Proxied so the Places key
 * never reaches a client, and nothing about the search is stored.
 */

const nearbyLimiter = createRateLimiter({ limit: 30, windowMs: 5 * 60_000 });

export async function GET(req: Request) {
	try {
		const userId = await getAuthUserId();
		if (!isPlacesConfigured(process.env.GOOGLE_PLACES_API_KEY)) {
			return NextResponse.json({ status: "unavailable" });
		}
		const params = new URL(req.url).searchParams;
		const location = cleanLocation(params.get("location"));
		if (!location) {
			return NextResponse.json({ error: `location must be 2 to ${MAX_LOCATION_LENGTH} characters` }, { status: 400 });
		}
		const rate = nearbyLimiter.check(userId);
		if (!rate.allowed) return NextResponse.json(
			{ error: "Too many searches. Try again shortly." },
			{ status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
		);
		return NextResponse.json({ status: "ok", results: await findServePlaces(location, params.get("kind") ?? "food") });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/serve/nearby] GET failed", err);
		return NextResponse.json({ error: "Search failed. Try again." }, { status: 502 });
	}
}
