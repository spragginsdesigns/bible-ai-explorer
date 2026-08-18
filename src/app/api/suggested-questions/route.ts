import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { generateSuggestedQuestions } from "@/lib/suggested-questions";

// One utility-model call plus context reads.
export const maxDuration = 60;

/**
 * The personalized questions for the empty chat screen. Every client asks once
 * per session and caches the answer in memory; nothing is persisted, so this is
 * always freshly drawn from the user's current walk (see
 * `src/lib/suggested-questions.ts`). Any failure returns the static six with
 * `personalized: false` rather than an error — the welcome screen must never
 * be empty.
 */
export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUser();
		return NextResponse.json(await generateSuggestedQuestions(userId));
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Error in suggested-questions route:", error);
		return NextResponse.json(
			{ error: "An unknown error occurred while processing your request." },
			{ status: 500 }
		);
	}
}
