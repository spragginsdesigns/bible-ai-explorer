import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { tracePersonConnection } from "@/lib/bible/atlas";

/** Find the shortest reviewed connection between two people. */
export async function GET(req: Request): Promise<Response> {
	try {
		await getAuthUserId();

		const params = new URL(req.url).searchParams;
		const from = params.get("from")?.trim();
		const to = params.get("to")?.trim();
		if (!from || !to) {
			return NextResponse.json({ error: "Both from and to person ids are required." }, { status: 400 });
		}

		const path = await tracePersonConnection(from, to);
		if (!path) {
			return NextResponse.json({ error: "No reviewed connection was found." }, { status: 404 });
		}
		return NextResponse.json({ path });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/bible/atlas/connection] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
