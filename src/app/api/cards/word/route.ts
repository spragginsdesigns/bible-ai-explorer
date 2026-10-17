import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { AiCredentialError } from "@/lib/ai/provider";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { createSharedAnswerId, isSharedAnswerId } from "@/lib/shared-answer";
import {
	MAX_RECIPIENT_LENGTH,
	MAX_SITUATION_LENGTH,
	WordInputError,
	cleanPersonalText,
	draftWord,
	personalCardContent,
	personalTextProblem,
} from "@/lib/share-cards/personal";
import { cardFitsEverySize } from "@/lib/share-cards/render";

/**
 * Send a word to someone (docs/FEATURES.md, "Share cards" -> "Send a word").
 *
 * POST /api/cards/word { recipient, situation, reference?, replaces? }
 *   -> { id, reference, text, word, fits }
 *
 * SureWord finds a KJV verse for what the recipient faces (or takes the one
 * the sender chose) and writes a word for them by name. The result is saved
 * as an unpublished SharedCard draft; POST /api/cards/personal publishes it
 * with the sender's own line and name. `situation` steers the verse and the
 * word and is then dropped: it is never stored, logged or returned.
 *
 * An AI call on the sender's account (consent policy "tap"), bounded per
 * account per hour because each draft costs a search and a model call.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

// Per account, per server instance (the limiter is in memory): a ceiling on
// model spend, not an exact quota.
const draftLimiter = createRateLimiter({ limit: 20, windowMs: 60 * 60_000 });
const DRAFT_LIFETIME_MS = 24 * 60 * 60_000;

function json(body: unknown, status = 200): Response {
	return NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
	try {
		const userId = await getAuthUser();
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		const recipient = cleanPersonalText(body?.recipient, MAX_RECIPIENT_LENGTH);
		const situation = cleanPersonalText(body?.situation, MAX_SITUATION_LENGTH);
		const reference = typeof body?.reference === "string" && body.reference.trim() ? body.reference.trim() : null;
		if (!recipient) return json({ error: "Who is it for? Add their first name." }, 400);
		const nameProblem = personalTextProblem(recipient);
		if (nameProblem) return json({ error: nameProblem }, 400);
		if (!situation) return json({ error: "Say a few words about what they are facing." }, 400);

		const rate = draftLimiter.check(userId);
		if (!rate.allowed) return json({ error: "You've written a lot of words this hour. Try again a little later." }, 429);

		const draft = await draftWord({ userId, recipient, situation, reference });

		// Drafts hold a name and a word that alludes to what someone faces, so
		// none is kept once it is no use: the one this replaces ("Write another
		// word", this account's only), and every account's unsent drafts older
		// than a day, so an abandoned draft does not wait for its owner to return.
		const replaces = typeof body?.replaces === "string" && isSharedAnswerId(body.replaces) ? body.replaces : null;
		await prisma.sharedCard.deleteMany({
			where: {
				publishedAt: null,
				OR: [
					...(replaces ? [{ id: replaces, userId }] : []),
					{ createdAt: { lt: new Date(Date.now() - DRAFT_LIFETIME_MS) } },
				],
			},
		});
		const card = await prisma.sharedCard.create({
			data: {
				id: createSharedAnswerId(),
				userId,
				kind: "word",
				reference: draft.reference,
				translation: "KJV",
				recipient,
				message: draft.word,
			},
			select: { id: true },
		});
		const fits = cardFitsEverySize(
			await personalCardContent(card.id, {
				reference: draft.reference,
				translation: "KJV",
				recipient,
				message: draft.word,
				personalLine: null,
				signature: null,
			})
		);
		return json({ id: card.id, reference: draft.reference, text: draft.text, word: draft.word, fits });
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof WordInputError) return json({ error: error.message }, 400);
		if (error instanceof AiCredentialError) return json({ error: error.message }, 403);
		console.error("Send a word failed:", error instanceof Error ? error.message : error);
		return json({ error: "SureWord couldn't write that word just now. Try again." }, 502);
	}
}
