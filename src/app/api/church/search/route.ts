import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { isPlacesConfigured } from "@/lib/church-rules";
import { searchChurches } from "@/lib/google-places";
import { createRateLimiter } from "@/lib/rateLimit";

/**
 * Church name search for the Settings picker, proxied through us so the Google
 * Places key never reaches a client.
 *
 * Authed: this is a paid third-party call, and only a signed-in user picking
 * their church has any reason to make it.
 */

const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 120;
const searchLimiter = createRateLimiter({ limit: 30, windowMs: 5 * 60_000 });

export async function GET(req: Request) {
	try {
		const userId = await getAuthUserId();
		if (!isPlacesConfigured(process.env.GOOGLE_PLACES_API_KEY)) {
			return NextResponse.json({ status: "unavailable" });
		}

		const query = (new URL(req.url).searchParams.get("q") ?? "").trim();
		if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
			return NextResponse.json(
				{ error: `q must be between ${MIN_QUERY_LENGTH} and ${MAX_QUERY_LENGTH} characters` },
				{ status: 400 }
			);
		}
		const rate = searchLimiter.check(userId);
		if (!rate.allowed) return NextResponse.json(
			{ error: "Too many church searches. Try again shortly." },
			{ status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
		);

		return NextResponse.json({ status: "ok", results: await searchChurches(query) });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/church/search] GET failed", err);
		return NextResponse.json({ error: "Church search is unavailable right now." }, { status: 500 });
	}
}
