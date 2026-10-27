import { NextResponse } from "next/server";
import { z } from "zod";
import { AiCredentialError } from "@/lib/ai/provider";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import {
	MEMORY_QUESTIONS_PROMPT_VERSION,
	MemoryQuestionsUnavailableError,
	writeMemoryQuestions,
} from "@/lib/beta/memory/memory-questions";
import { MemoryInputError, rangeFromReference, saveQuestions, unitForQuestions } from "@/lib/beta/memory/memory";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { hasCurrentAiConsent } from "@/lib/preferences-contract";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const bodySchema = z.object({ reference: z.string().trim().min(1).max(80) }).strict();

/**
 * POST /api/beta/memory/questions `{ reference }`: write comprehension
 * questions for one card or passage already in the deck (docs/beta/memory.md).
 * AI runs only here, only when a founder taps for it, and only with their AI
 * consent on the account. A new set replaces the old one.
 */
export async function POST(req: Request) {
	// The gate runs first, so anyone off the list meets the plain 404 before the meter reads a header.
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	return meteredPost(req, gate.userId);
}

const meteredPost = withIncludedAiRequest(handlePost, "beta-memory");

async function handlePost(req: Request, userId: string): Promise<Response> {
	try {
		const parsed = bodySchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json({ error: "Send the 'reference' of a card, such as John 3:16." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
		}
		const range = rangeFromReference(parsed.data.reference);
		const account = await prisma.user.findUnique({ where: { id: userId }, select: { aiConsentVersion: true, aiConsentAt: true } });
		if (!hasCurrentAiConsent(account)) {
			return NextResponse.json(
				{ error: "Allow AI in Settings to write questions.", code: "ai_consent_required" },
				{ status: 403, headers: BETA_PRIVATE_HEADERS },
			);
		}
		const unit = await unitForQuestions(userId, range);
		if (!unit) {
			return NextResponse.json({ error: "Add these verses to your cards first." }, { status: 404, headers: BETA_PRIVATE_HEADERS });
		}
		const written = await writeMemoryQuestions({ userId: userId, range, ...unit });
		await saveQuestions(userId, range, unit.translation, written.questions, written.model, MEMORY_QUESTIONS_PROMPT_VERSION);
		return NextResponse.json({ questions: written.questions, translation: unit.translation }, { headers: BETA_PRIVATE_HEADERS });
	} catch (error) {
		if (error instanceof MemoryInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status, headers: BETA_PRIVATE_HEADERS });
		}
		if (error instanceof AiCredentialError) {
			return NextResponse.json({ error: error.message }, { status: 403, headers: BETA_PRIVATE_HEADERS });
		}
		if (error instanceof MemoryQuestionsUnavailableError) {
			console.error("[api/beta/memory/questions] unavailable:", error.message);
			return NextResponse.json(
				{ error: "Questions could not be written right now. Please try again.", code: "unavailable" },
				{ status: 502, headers: BETA_PRIVATE_HEADERS },
			);
		}
		console.error("[api/beta/memory/questions] POST failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: BETA_PRIVATE_HEADERS });
	}
}
