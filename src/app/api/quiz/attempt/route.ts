import { NextResponse } from "next/server";
import { captureServerEvent } from "@/lib/analytics/server";
import { ANALYTICS_EVENTS, platformFromHeaders } from "@/lib/analytics/events";
import { getAuthUser } from "@/lib/auth";
import { bookByOrder } from "@/lib/bible/books";
import { recordQuizAttempt } from "@/lib/quiz";
import { parseAttempt } from "@/lib/quiz-rules";

/**
 * Record a finished "Quiz me": the chapter, the depth, the score and which
 * verses were missed. Never the questions or the answers. The misses feed
 * the study context so a later day can come back to them.
 */
export async function POST(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const parsed = parseAttempt(await req.json().catch(() => null));
		if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
		const meta = bookByOrder(parsed.book);
		if (!meta || parsed.chapter > meta.chapters) {
			return NextResponse.json({ error: "invalid_reference" }, { status: 400 });
		}

		const id = await recordQuizAttempt(userId, parsed);
		captureServerEvent({
			userId,
			event: ANALYTICS_EVENTS.quizCompleted,
			platform: platformFromHeaders(req.headers),
			properties: {
				book: parsed.book,
				chapter: parsed.chapter,
				depth: parsed.depth,
				total: parsed.total,
				correct: parsed.correct,
			},
		});
		return NextResponse.json({ id }, { status: 201 });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Error in quiz attempt route:", error);
		return NextResponse.json({ error: "Could not save this quiz." }, { status: 500 });
	}
}
