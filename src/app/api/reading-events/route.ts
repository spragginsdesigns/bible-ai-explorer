import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { recordLegacyReading, ReadingLogError } from "@/lib/reading-log";
import { loadReadingHistory } from "@/lib/reading-history";

const eventSchema = z.object({
	book: z.string().min(1).max(50),
	chapter: z.number().int().min(1).max(200),
	translation: z.string().min(1).max(20).optional(),
});

/**
 * The caller's reading history, summarized: the chapter to continue from,
 * chapter and day counts over the last week and month in their own timezone,
 * the current streak, the books they read most, and the latest reads.
 */
export async function GET() {
	try {
		const userId = await getAuthUser();
		return NextResponse.json(await loadReadingHistory(userId));
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof ReadingLogError) return NextResponse.json({ error: error.message }, { status: error.status });
		console.error("[api/reading-events] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * Record that the caller read a chapter. Intentionally dumb: the clients
 * debounce (a few seconds on screen before posting) and we skip the insert
 * when the same user/book/chapter was already recorded within the last hour,
 * so re-opening a chapter does not inflate the reading history.
 */
export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();

		const parsed = eventSchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json(
				{ error: "Invalid input: 'book' and 'chapter' are required." },
				{ status: 400 }
			);
		}
		const { book, chapter, translation } = parsed.data;

		return NextResponse.json(await recordLegacyReading(userId, book, chapter, translation));
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof ReadingLogError) return NextResponse.json({ error: error.message }, { status: error.status });
		console.error("[api/reading-events] POST failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
