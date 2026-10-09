import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getReadingOverview, resolveTimezoneFor } from "@/lib/reading-overview";
import { readingLogFailure } from "@/lib/reading-log-http";

/**
 * The reading log header: lifetime totals, streak and the Bible map
 * (`ReadingOverview` in src/lib/reading-overview.ts). `?tz=` is the client's
 * IANA timezone, which decides whether today already counts toward the streak.
 */
export async function GET(request: Request) {
	try {
		const userId = await getAuthUser();
		const timezone = await resolveTimezoneFor(userId, new URL(request.url).searchParams.get("tz"));
		return NextResponse.json(await getReadingOverview(userId, timezone));
	} catch (error) {
		return readingLogFailure(error);
	}
}
