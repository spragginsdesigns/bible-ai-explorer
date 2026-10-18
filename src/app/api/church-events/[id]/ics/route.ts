import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { churchEventIcs } from "@/lib/church-events";

/**
 * One church event as an .ics file: the "Apple Calendar" button on web (Safari
 * on iPhone and Mac offers to add it straight to Calendar) and "Other calendar"
 * on Android, which saves it and hands it to the phone's calendar app. Behind
 * the session like the studies, so only the reader's own church is served.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const file = await churchEventIcs(userId, id);
		if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
		return new Response(file.body, {
			headers: {
				"content-type": "text/calendar; charset=utf-8",
				// Inline, not attachment: Safari on iPhone only offers "Add to
				// Calendar" for an inline calendar; as an attachment it goes to Files.
				"content-disposition": `inline; filename="${file.fileName}"`,
				"cache-control": "private, no-store",
			},
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[church-events] ics failed", error);
		return NextResponse.json({ error: "Failed to build the calendar file" }, { status: 500 });
	}
}
