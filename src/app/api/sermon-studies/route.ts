import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { listSermonStudies } from "@/lib/sermon-studies";

/**
 * Guided studies for the reader's own church, newest first. An account with no
 * church, or a church with no ingest wired up, gets an empty list rather than
 * an error: every client hides the section entirely when this is empty, the
 * same way "My church" and "Listen" disappear when unconfigured.
 */
export async function GET() {
	try {
		const userId = await getAuthUser();
		return NextResponse.json({ studies: await listSermonStudies(userId) });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[sermon-studies] list failed", error);
		return NextResponse.json({ error: "Failed to load sermon studies" }, { status: 500 });
	}
}
