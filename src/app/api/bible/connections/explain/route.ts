import { waitUntil } from "@vercel/functions";
import { createTextStreamResponse, streamText, toTextStream } from "ai";
import { NextResponse } from "next/server";
import { plainDashes } from "@/lib/ai/plain-dashes";
import { AiCredentialError, resolveModel } from "@/lib/ai/provider";
import { reserveIncludedRequest, withIncludedAiRequest } from "@/lib/billing/usage";
import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { connectionSectionOf, CONNECTION_SECTIONS } from "@/lib/bible/connectionsMap";
import { getCrossReferencesFor } from "@/lib/bible/crossRefs";
import { getVerseText, type TranslationId } from "@/lib/bible/translations";
import { readVerseInsight, writeVerseInsight } from "@/lib/verse-insight-cache";
import { getAuthUser } from "@/lib/auth";
import { connectionsSystemPrompt } from "@/utils/systemPrompt";

export const maxDuration = 60;

/** Passages explained per answer: the sheet's cards, and a bounded prompt. */
const MAX_LINKS = 10;
/**
 * Folded into the cached text so these rows can never collide with a
 * tap-a-verse explanation of the same verse; bump it when the prompt changes.
 */
const CACHE_TAG = "connections-v1";

/**
 * "Ask why these connect": stream how one verse ties to the passages the
 * cross-reference set links it to, as a summary line plus one
 * "REFERENCE :: explanation" line per passage (parsed into tagged cards by
 * every client). The server picks the passages, optionally narrowed to one
 * section, so the model explains Scripture's links instead of inventing its
 * own. Cached and shared like /api/verse-insight: the prompt holds only
 * Scripture, so nothing about the reader is stored.
 */
export const POST = withIncludedAiRequest(handlePost, "connections-explain");

async function handlePost(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const body: unknown = await req.json();
		const data = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

		const rawReference = typeof data.reference === "string" ? data.reference.trim().slice(0, 80) : "";
		const target = rawReference ? resolveReference(rawReference) : null;
		const book = target ? bookByOrder(target.order) : null;
		if (!target || target.verse === undefined || !book) {
			return NextResponse.json({ error: "Choose a single verse to explain its connections." }, { status: 400 });
		}
		const translation: TranslationId =
			data.translation === "BSB" ? "BSB" : data.translation === "NKJV" ? "NKJV" : "KJV";
		const section =
			typeof data.section === "string" ? CONNECTION_SECTIONS.find((s) => s.id === data.section) ?? null : null;
		const modelId = typeof data.modelId === "string" ? data.modelId : null;

		const reference = `${book.name} ${target.chapter}:${target.verse}`;
		let verseText: string | null | undefined;
		try {
			verseText = await getVerseText(translation, target.order, target.chapter, target.verse);
		} catch {
			return NextResponse.json({ error: `The ${translation} text is unavailable right now.` }, { status: 503 });
		}
		if (!verseText) {
			return NextResponse.json({ error: "That verse could not be found." }, { status: 400 });
		}
		const links = (await getCrossReferencesFor(target.order, target.chapter, target.verse))
			.filter(
				(link) => !(link.order === target.order && link.chapter === target.chapter && link.verse === target.verse)
			)
			.filter((link) => !section || connectionSectionOf(link.order).id === section.id)
			.slice(0, MAX_LINKS);
		if (links.length === 0) {
			return NextResponse.json({ error: "No connected passages are listed for this verse." }, { status: 404 });
		}
		const passages = await Promise.all(
			links.map(async (link) => {
				const name = bookByOrder(link.order)?.name ?? `Book ${link.order}`;
				const text = await getVerseText(translation, link.order, link.chapter, link.verse).catch(() => null);
				return { reference: `${name} ${link.chapter}:${link.verse}`, text: text ?? "" };
			})
		);

		const material = [
			`Verse: ${reference} (${translation})\n${verseText}`,
			"Connected passages, in order:",
			...passages.map((p) => `${p.reference}: ${p.text}`),
		].join("\n\n");

		let resolved;
		try {
			resolved = await resolveModel({ userId, modelId, effort: "low", deferReservation: true });
		} catch (error) {
			if (error instanceof AiCredentialError) return NextResponse.json({ error: error.message }, { status: 403 });
			throw error;
		}
		const modelUsed = resolved.definition.id;
		const cacheKey = {
			translation,
			reference: `Connections ${reference}${section ? ` (${section.id})` : ""}`,
			text: `${CACHE_TAG}\n${material}`,
			modelId: modelUsed,
			effort: resolved.effort,
		};
		const cached = await readVerseInsight(cacheKey);
		if (cached) {
			return new Response(cached, {
				headers: { "Content-Type": "text/plain; charset=utf-8", "X-Connections-Cache": "hit" },
			});
		}

		if (resolved.access === "house") await reserveIncludedRequest(userId);
		const result = streamText({
			model: resolved.model,
			system: connectionsSystemPrompt(translation),
			prompt: material,
			maxOutputTokens: 2500,
			providerOptions: resolved.providerOptions,
			experimental_transform: plainDashes(),
			onEnd: ({ text: full, finishReason }) => {
				if (finishReason !== "stop" || !full.includes("::")) return;
				waitUntil(writeVerseInsight(cacheKey, full, modelUsed));
			},
		});
		// Finish even if the sheet closes, so the next reader gets the cache.
		result.consumeStream();
		return createTextStreamResponse({
			stream: toTextStream({ stream: result.stream }),
			headers: { "X-Connections-Cache": "miss" },
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/bible/connections/explain] request failed", error);
		return NextResponse.json({ error: "Could not explain these connections. Please try again." }, { status: 500 });
	}
}
