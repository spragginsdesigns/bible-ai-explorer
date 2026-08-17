import { createTextStreamResponse, streamText, toTextStream } from "ai";
import { NextResponse } from "next/server";
import { AiCredentialError, resolveModel } from "@/lib/ai/provider";
import { getAuthUser } from "@/lib/auth";
import { verseInsightSystemPrompt } from "@/utils/systemPrompt";

export const maxDuration = 60;

const MAX_REFERENCE_LENGTH = 120;
const MAX_TEXT_LENGTH = 2500;

/**
 * Tap-a-verse: stream a short explanation of a single verse as plain text.
 * Serves the reader sheet on Android and web. Unlike ask-question this is a
 * passive touch — it never persists anything and never records the model used
 * as the account default.
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
		const translation = data.translation === "NKJV" ? "NKJV" : "KJV";
		const modelId = typeof data.modelId === "string" ? data.modelId : null;

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

		const result = streamText({
			model: resolved.model,
			system: verseInsightSystemPrompt(translation),
			prompt: `${reference} (${translation})\n"${text}"`,
			maxOutputTokens: 2000,
			providerOptions: resolved.providerOptions,
		});

		return createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) });
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
