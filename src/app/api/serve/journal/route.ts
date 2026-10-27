import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { addServeEntry, listServeEntries, resolveVerseRef } from "@/lib/serve";
import { MAX_ENTRY_LENGTH, cleanEntryText, parseVerseRef } from "@/lib/serve-rules";

/**
 * The Ways to Serve journal ("What I did"): private notes of moments of love,
 * in the reader's own words. Never counted or shown to anyone else.
 */

export async function GET() {
	try {
		const userId = await getAuthUser();
		return NextResponse.json({ status: "ok", entries: await listServeEntries(userId) });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/serve/journal] GET failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/** `{ text, verseRef? }`. A verse that is not real KJV is dropped, not refused. */
export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		const body: unknown = await req.json().catch(() => null);
		const record = typeof body === "object" && body !== null ? (body as { text?: unknown; verseRef?: unknown }) : {};
		const text = cleanEntryText(record.text);
		if (!text) return NextResponse.json({ error: `text must be 1 to ${MAX_ENTRY_LENGTH} characters` }, { status: 400 });
		const verseRef = await resolveVerseRef(parseVerseRef(record.verseRef));
		return NextResponse.json({ status: "ok", entry: await addServeEntry(userId, text, verseRef) });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/serve/journal] POST failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
