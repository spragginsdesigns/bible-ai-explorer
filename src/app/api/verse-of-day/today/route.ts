import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { scheduleDailyCrossAudio } from "@/lib/daily-cross-audio";
import {
	DailyCrossReferenceError,
	findTodayCross,
	generateDailyCross,
	replaceDailyCross,
	storeDailyCross,
	type DailyCross,
} from "@/lib/daily-cross";

/** A steer the user typed ("something on fear") — long enough to be useful, short enough to be a steer. */
const MAX_FOCUS_LENGTH = 200;

// Generating a fresh day is one utility-model call plus context reads.
export const maxDuration = 120;

function toResponse(cross: DailyCross, sentAt: Date) {
	return {
		reference: `${cross.book} ${cross.chapter}:${cross.verse}`,
		book: cross.book,
		chapter: cross.chapter,
		verse: cross.verse,
		text: cross.text,
		reason: cross.reason,
		whyToday: cross.whyToday,
		application: cross.application,
		studyPath: cross.studyPath,
		question: cross.question,
		sentAt: sentAt.toISOString(),
	};
}

/**
 * Today's "Pick Up Your Cross" entry for the caller. Serves the Daily Cross
 * screen on Android and web. Returns the entry the morning cron stored when
 * one exists inside the reuse window; otherwise generates one on demand and
 * stores it — so the feature works fully for users with notifications off or
 * push unavailable.
 */
export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUser();

		const existing = await findTodayCross(userId);
		if (existing) return NextResponse.json(toResponse(existing, existing.sentAt));

		const cross = await generateDailyCross(userId);
		const { sentAt } = await storeDailyCross(userId, cross);

		// A day generated on demand earns its spoken devotional the same way the
		// cron's does: started now, in the background, so the Listen card is
		// already preparing by the time this response paints. Only the entitlement
		// check is awaited here - the narration itself runs past the response.
		await scheduleDailyCrossAudio(userId).catch((error: unknown) => {
			console.error(`[verse-of-day/today] Could not schedule audio for ${userId}:`, error);
		});

		return NextResponse.json(toResponse(cross, sentAt));
	} catch (error) {
		return errorResponse(error);
	}
}

/**
 * Replace today's entry with a freshly generated one — the "a different word
 * for today" control on every client's Daily Cross screen, and the `setDailyCross`
 * chat tool. Body (all optional): `{ focus, book, chapter, verse }`; `focus`
 * steers the choice in the user's own words, and a full book/chapter/verse pins
 * the day to a verse they named.
 */
export async function POST(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();

		const body: unknown = await req.json().catch(() => ({}));
		const data = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

		const focus =
			typeof data.focus === "string" && data.focus.trim()
				? data.focus.trim().slice(0, MAX_FOCUS_LENGTH)
				: undefined;

		// A pinned verse needs all three parts; a partial reference is a client
		// bug, not a request to guess.
		const hasReferencePart =
			data.book !== undefined || data.chapter !== undefined || data.verse !== undefined;
		const verse =
			typeof data.book === "string" &&
			data.book.trim() &&
			Number.isInteger(data.chapter) &&
			Number.isInteger(data.verse) &&
			(data.chapter as number) >= 1 &&
			(data.verse as number) >= 1
				? {
						book: data.book.trim(),
						chapter: data.chapter as number,
						verse: data.verse as number,
					}
				: undefined;
		if (hasReferencePart && !verse) {
			return NextResponse.json(
				{ error: "A pinned verse needs a book name, a chapter number and a verse number." },
				{ status: 400 }
			);
		}

		const { cross } = await replaceDailyCross(userId, { focus, verse });
		return NextResponse.json(toResponse(cross, cross.sentAt));
	} catch (error) {
		return errorResponse(error);
	}
}

function errorResponse(error: unknown): Response {
	if (error instanceof Response) return error;
	// A reference the user typed wrong is their correction to make, not a 500.
	if (error instanceof DailyCrossReferenceError) {
		return NextResponse.json({ error: error.message }, { status: 400 });
	}
	console.error("Error in verse-of-day/today route:", error);
	return NextResponse.json(
		{
			error:
				error instanceof Error
					? `An error occurred: ${error.message}`
					: "An unknown error occurred while processing your request.",
		},
		{ status: 500 }
	);
}
