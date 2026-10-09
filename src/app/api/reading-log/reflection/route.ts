import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { resolveTimezoneFor } from "@/lib/reading-overview";
import { getReadingReflection } from "@/lib/reading-reflection";

// Usually one row read; the budget covers the one generation after new reading.
export const maxDuration = 60;

/**
 * "Your walk" for the reading log: `{ status: "ready", reflection, generatedAt }`,
 * or `empty` (no reading yet), `consent-required` (nothing generated without AI
 * consent) or `unavailable` (generation failed and nothing older is stored).
 * Clients gate this route as an automatic AI request (src/lib/ai-consent-gate.ts).
 */
export async function GET(request: Request) {
	try {
		const userId = await getAuthUser();
		const timezone = await resolveTimezoneFor(userId, new URL(request.url).searchParams.get("tz"));
		return NextResponse.json(await getReadingReflection(userId, timezone));
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Error in reading-log reflection route:", error);
		return NextResponse.json({ status: "unavailable" }, { status: 500 });
	}
}
