import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
	findTodayCross,
	generateDailyCross,
	storeDailyCross,
	type DailyCross,
} from "@/lib/daily-cross";

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
		const sentAt = await storeDailyCross(userId, cross);
		return NextResponse.json(toResponse(cross, sentAt));
	} catch (error) {
		if (error instanceof Response) return error;
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
}
