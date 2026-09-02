import { waitUntil } from "@vercel/functions";
import { createTextStreamResponse, streamText, toTextStream } from "ai";
import { NextResponse } from "next/server";
import { AiCredentialError, resolveModel } from "@/lib/ai/provider";
import { getAuthUser } from "@/lib/auth";
import type { TranslationId } from "@/lib/bible/translations";
import { readVerseInsight, writeVerseInsight } from "@/lib/verse-insight-cache";
import { verseInsightSystemPrompt } from "@/utils/systemPrompt";

export const maxDuration = 60;

const MAX_REFERENCE_LENGTH = 120;
const MAX_TEXT_LENGTH = 2500;

/**
 * Tap-a-verse: stream a short explanation of a single verse as plain text.
 * Serves the reader sheet on Android, web and the Apple apps. Unlike
 * ask-question this is a passive touch: it never records the model used as the
 * account default and writes nothing about the user.
 *
 * Explanations are cached server-side and shared across accounts
 * (`src/lib/verse-insight-cache.ts`): the prompt carries only the verse, so
 * the first reader of a verse pays for the model and everyone after reads the
 * stored text. A hit is answered as a single plain-text body with
 * `X-Verse-Insight-Cache: hit`; clients read it through the same stream path.
 */
export async function POST(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();

		const body: unknown = await req.json();
		const data =
			typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

		const reference = typeof data.reference === "string" ? data.reference.trim() : "";
		const text = typeof data.text === "string" ? data.text.trim() : "";
		if (
			!reference ||
			!text ||
			reference.length > MAX_REFERENCE_LENGTH ||
			text.length > MAX_TEXT_LENGTH
		) {
			return NextResponse.json(
				{ error: "Invalid input: 'reference' and 'text' are required." },
				{ status: 400 }
			);
		}
		const translation: TranslationId = data.translation === "NKJV" ? "NKJV" : "KJV";
		const modelId = typeof data.modelId === "string" ? data.modelId : null;

		const cacheKey = { translation, reference, text };
		const cached = await readVerseInsight(cacheKey);
		if (cached) {
			return new Response(cached, {
				headers: {
					"Content-Type": "text/plain; charset=utf-8",
					"X-Verse-Insight-Cache": "hit",
				},
			});
		}

		let resolved;
		try {
			// The user's universal model pick applies, but effort is pinned low —
			// a tap in the reader has to answer in seconds, whatever the user's
			// chat reasoning default is.
			resolved = await resolveModel({ userId, modelId, effort: "low" });
		} catch (error) {
			if (error instanceof AiCredentialError) {
				return NextResponse.json({ error: error.message }, { status: 403 });
			}
			throw error;
		}

		const modelUsed = resolved.definition.id;
		const result = streamText({
			model: resolved.model,
			system: verseInsightSystemPrompt(translation),
			prompt: `${reference} (${translation})\n"${text}"`,
			maxOutputTokens: 2000,
			providerOptions: resolved.providerOptions,
			onEnd: ({ text: full, finishReason }) => {
				// Only a naturally finished, non-empty answer is worth keeping:
				// a length cut-off or an error mid-stream must regenerate next tap.
				if (finishReason !== "stop" || !full.trim()) return;
				waitUntil(writeVerseInsight(cacheKey, full, modelUsed));
			},
		});
		// Run to completion even if the reader closes the sheet, so the
		// explanation still lands in the cache for the next tap.
		result.consumeStream();

		return createTextStreamResponse({
			stream: toTextStream({ stream: result.stream }),
			headers: { "X-Verse-Insight-Cache": "miss" },
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Error in verse-insight route:", error);
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
