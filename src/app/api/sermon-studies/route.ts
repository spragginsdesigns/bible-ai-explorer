import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { listChurchEvents } from "@/lib/church-events";
import { listSermonStudies } from "@/lib/sermon-studies";

/**
 * Guided studies for the reader's own church, newest first. An account with no
 * church, or a church with no ingest wired up, gets an empty list rather than
 * an error: every client hides the section entirely when this is empty, the
 * same way "My church" and "Listen" disappear when unconfigured.
 *
 * `events` are the church's coming gatherings, announced during those same
 * services, and `churchApp` is where an unsure time can be checked. They ride
 * along here so the screen that shows them needs no second request.
 */
export async function GET() {
	try {
		const userId = await getAuthUser();
		const [studies, { events, churchApp }] = await Promise.all([
			listSermonStudies(userId),
			listChurchEvents(userId),
		]);
		return NextResponse.json({ studies, events, churchApp });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[sermon-studies] list failed", error);
		return NextResponse.json({ error: "Failed to load sermon studies" }, { status: 500 });
	}
}
