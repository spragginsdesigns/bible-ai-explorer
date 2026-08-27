import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { getEvent } from "@/lib/bible/atlas";

/** Return one fully-resolved atlas event for the event detail view. */
export async function GET(req: Request): Promise<Response> {
	try {
		await getAuthUserId();

		const id = new URL(req.url).searchParams.get("id")?.trim();
		if (!id) return NextResponse.json({ error: "An event id is required." }, { status: 400 });

		const event = await getEvent(id);
		if (!event) return NextResponse.json({ error: "No such event." }, { status: 404 });
		return NextResponse.json({ event });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/bible/atlas/event] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
