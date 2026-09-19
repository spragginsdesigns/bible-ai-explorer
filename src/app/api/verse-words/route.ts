import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { AiCredentialError } from "@/lib/ai/provider";
import { captureServerEvent, flushAnalytics } from "@/lib/analytics/server";
import { ANALYTICS_EVENTS, platformFromHeaders } from "@/lib/analytics/events";
import { getAuthUser } from "@/lib/auth";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import {
	generateVerseWordStudy,
	readVerseWordStudy,
	resolveStudyModel,
	VerseWordsUnavailableError,
	writeVerseWordStudy,
} from "@/lib/verse-words";

export const maxDuration = 60;

/** A 1-based integer from JSON: digits only, so 1.5 and "6" are rejected. */
function positiveInteger(raw: unknown): number | null {
	return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : null;
}

/**
 * Words tab of the verse sheet: the interlinear rows and the short study for
 * one verse, generated from the bundled Hebrew or Greek plus the KJV and
 * cached across accounts (`src/lib/verse-words.ts`). Serves Android, web and
 * the Apple apps. Like tap-a-verse, a passive touch: it never records the
 * model as the account default and writes nothing about the user.
 */
export const POST = withIncludedAiRequest(handlePost, "verse-words");

async function handlePost(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();

		const body: unknown = await req.json();
		const data =
			typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
		const book = positiveInteger(data.book);
		const chapter = positiveInteger(data.chapter);
		const verse = positiveInteger(data.verse);
		if (book === null || book > 66 || chapter === null || verse === null) {
			return NextResponse.json({ error: "invalid_reference" }, { status: 400 });
		}
		const modelId = typeof data.modelId === "string" ? data.modelId : null;
		const platform = platformFromHeaders(req.headers);

		const cached = await readVerseWordStudy({ book, chapter, verse });
		if (cached) {
			// Coordinates, not words: which verse is being studied is the shape of
			// the tap, and the study itself never leaves the response.
			captureServerEvent({
				userId,
				event: ANALYTICS_EVENTS.verseWordStudied,
				platform,
				properties: { book, chapter, verse, cacheHit: true },
			});
			await flushAnalytics();
			return NextResponse.json(cached, { headers: { "X-Verse-Words-Cache": "hit" } });
		}

		let resolved;
		try {
			resolved = await resolveStudyModel(userId, modelId);
		} catch (error) {
			if (error instanceof AiCredentialError) {
				return NextResponse.json({ error: error.message }, { status: 403 });
			}
			throw error;
		}

		let study;
		try {
			study = await generateVerseWordStudy({ book, chapter, verse, resolved });
		} catch (error) {
			// A chapter the KJV does not have throws from the chapter loader;
			// to a client that is the same answer as a verse the texts lack.
			if (error instanceof Error && /^Unknown chapter/.test(error.message)) study = null;
			else throw error;
		}
		if (!study) {
			return NextResponse.json({ error: "not_found" }, { status: 404 });
		}

		captureServerEvent({
			userId,
			event: ANALYTICS_EVENTS.verseWordStudied,
			platform,
			properties: { book, chapter, verse, cacheHit: false },
		});
		waitUntil(writeVerseWordStudy(study));
		await flushAnalytics();
		return NextResponse.json(study, { headers: { "X-Verse-Words-Cache": "miss" } });
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof VerseWordsUnavailableError) {
			return NextResponse.json({ error: error.message, code: "unavailable" }, { status: 502 });
		}
		console.error("Error in verse-words route:", error);
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
