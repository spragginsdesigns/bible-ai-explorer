import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getSuggestedQuestions, toSuggestedQuestionsResponse } from "@/lib/suggested-questions";

// Usually a single DB read; the 60s budget covers the one generation per day
// when no stored set exists yet.
export const maxDuration = 60;

/**
 * The personalized questions for the empty chat screen, as
 * `{ questions: string[], items: { question, label }[], personalized }`.
 * `questions` is unchanged from before labels existed so that already-installed
 * clients keep working; `items` adds the gold caption above each chip (a
 * Scripture reference, one of `SUGGESTED_QUESTION_KINDS`, or null) in the same
 * order. Served from the day's
 * stored set (pre-warmed by the verse-of-day cron) so opening the app is
 * instant; only the first request of a day without a stored set pays for a
 * generation (see `src/lib/suggested-questions.ts`). Any failure returns the
 * static six with `personalized: false` rather than an error - the welcome
 * screen must never be empty.
 */
export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUser();
		return NextResponse.json(toSuggestedQuestionsResponse(await getSuggestedQuestions(userId)));
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Error in suggested-questions route:", error);
		return NextResponse.json(
			{ error: "An unknown error occurred while processing your request." },
			{ status: 500 }
		);
	}
}
