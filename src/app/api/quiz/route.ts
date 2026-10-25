import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { AiCredentialError } from "@/lib/ai/provider";
import { captureServerEvent } from "@/lib/analytics/server";
import { ANALYTICS_EVENTS, platformFromHeaders } from "@/lib/analytics/events";
import { getAuthUser } from "@/lib/auth";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { bookByOrder } from "@/lib/bible/books";
import {
	chapterQuiz,
	generateChapterQuiz,
	QuizUnavailableError,
	readQuizBank,
	resolveQuizModel,
	suggestedQuizDepth,
	writeQuizBank,
} from "@/lib/quiz";
import { isQuizDepth } from "@/lib/quiz-rules";

export const maxDuration = 60;

/** A 1-based integer from JSON: digits only, so 1.5 and "6" are rejected. */
function positiveInteger(raw: unknown): number | null {
	return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : null;
}

/**
 * "Quiz me" (docs/FEATURES.md): five questions on one chapter, every answer
 * tied to a verse checked against the bundled KJV (`src/lib/quiz.ts`). The
 * bank is shared across accounts, so a chapter someone has already been
 * quizzed on costs no model call. Serves Android, web and the Apple apps.
 *
 * Body: `{ book, chapter, depth?: "seeking" | "growing" | null, modelId? }`.
 * No depth means the one this reader's own words suggest.
 */
export const POST = withIncludedAiRequest(handlePost, "quiz");

async function handlePost(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();

		const body: unknown = await req.json().catch(() => null);
		const data = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
		const book = positiveInteger(data.book);
		const chapter = positiveInteger(data.chapter);
		const meta = book === null ? null : bookByOrder(book);
		if (!meta || chapter === null || chapter > meta.chapters) {
			return NextResponse.json({ error: "invalid_reference" }, { status: 400 });
		}
		if (data.depth !== undefined && data.depth !== null && !isQuizDepth(data.depth)) {
			return NextResponse.json({ error: "invalid_depth" }, { status: 400 });
		}
		const modelId = typeof data.modelId === "string" ? data.modelId : null;
		const platform = platformFromHeaders(req.headers);

		const suggestedDepth = await suggestedQuizDepth(userId);
		const depth = isQuizDepth(data.depth) ? data.depth : suggestedDepth;
		const key = { book: meta.order, chapter, depth };

		const cached = await readQuizBank(key);
		if (cached) {
			// Coordinates and the depth, never a question: which chapter someone
			// was quizzed on is the shape of the tap, the questions stay here.
			captureServerEvent({
				userId,
				event: ANALYTICS_EVENTS.quizStarted,
				platform,
				properties: { book: key.book, chapter, depth, cacheHit: true },
			});
			return NextResponse.json(chapterQuiz(key, cached, suggestedDepth, true), {
				headers: { "X-Quiz-Cache": "hit" },
			});
		}

		let resolved;
		try {
			resolved = await resolveQuizModel(userId, modelId);
		} catch (error) {
			if (error instanceof AiCredentialError) {
				return NextResponse.json({ error: error.message }, { status: 403 });
			}
			throw error;
		}

		const generated = await generateChapterQuiz({ ...key, resolved });
		if (!generated) return NextResponse.json({ error: "invalid_reference" }, { status: 400 });

		captureServerEvent({
			userId,
			event: ANALYTICS_EVENTS.quizStarted,
			platform,
			properties: { book: key.book, chapter, depth, cacheHit: false, questions: generated.questions.length },
		});
		// A short set (a chapter too small for five good questions, or a model
		// that wrote too few) is served but not stored, so the next reader gets
		// a fresh chance at a full one.
		if (generated.complete) waitUntil(writeQuizBank(key, generated));
		return NextResponse.json(chapterQuiz(key, generated, suggestedDepth, false), {
			headers: { "X-Quiz-Cache": "miss" },
		});
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof QuizUnavailableError) {
			console.error("quiz unavailable:", error.message);
			return NextResponse.json(
				{ error: "This quiz could not be written right now. Please try again.", code: "unavailable" },
				{ status: 502 }
			);
		}
		console.error("Error in quiz route:", error);
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
