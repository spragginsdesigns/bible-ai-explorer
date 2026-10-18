import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { isSharedAnswerId } from "@/lib/shared-answer";
import {
	MAX_PERSONAL_LINE_LENGTH,
	MAX_SIGNATURE_LENGTH,
	PERSONAL_CARD_SELECT,
	cleanPersonalText,
	personalCardContent,
	personalCardUrl,
	personalTextProblem,
} from "@/lib/share-cards/personal";
import { cardFitsEverySize } from "@/lib/share-cards/render";
import { MAX_REFLECTION_LENGTH, reflectionPresentation, validReflectionPresentation } from "@/lib/share-cards/reflection-contract";

/**
 * Send a personal card (docs/FEATURES.md, "Share cards" -> "Send a word").
 *
 * POST /api/cards/personal { draftId, personalLine?, signature? } -> { id, url }
 * GET  /api/cards/personal -> { cards: [{ id, url, kind, reference, recipient, createdAt, revokedAt }] }
 *
 * Publishing freezes a "send a word" draft: whoever receives it must never
 * see it change. So the write is one conditional update on an unsent draft,
 * and publishing a card that was already sent changes nothing and returns
 * its link. SureWord's word was written by the server when the draft was made
 * and is never read from this request; the sender's line and name are theirs,
 * held to `personalTextProblem` (no "SureWord", no links or addresses), and a
 * line must carry the name of the person who wrote it.
 */
export const runtime = "nodejs";

const publishLimiter = createRateLimiter({ limit: 30, windowMs: 5 * 60_000 });

function json(body: unknown, status = 200): Response {
	return NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
	try {
		const userId = await getAuthUser();
		const rate = publishLimiter.check(userId);
		if (!rate.allowed) return json({ error: "Too many cards at once. Try again in a few minutes." }, 429);

		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		const draftId = typeof body?.draftId === "string" ? body.draftId : "";
		if (!isSharedAnswerId(draftId)) return json({ error: "Not found" }, 404);
		const draft = await prisma.sharedCard.findFirst({
			where: { id: draftId, userId, kind: { in: ["word", "reflection"] }, revokedAt: null },
			select: { ...PERSONAL_CARD_SELECT, publishedAt: true },
		});
		if (!draft) return json({ error: "Not found" }, 404);
		const isReflection = draft.kind === "reflection";
		if (isReflection && (typeof body?.personalLine !== "string" || body.personalLine.length > MAX_REFLECTION_LENGTH || !body.personalLine.trim())) return json({ error: "Add a reflection of up to 200 characters." }, 400);
		if (isReflection && !validReflectionPresentation(body?.presentation)) return json({ error: "Choose a reflection font and placement." }, 400);
		const personalLine = cleanPersonalText(body?.personalLine, isReflection ? MAX_REFLECTION_LENGTH : MAX_PERSONAL_LINE_LENGTH);
		if (isReflection && !personalLine) return json({ error: "Add a reflection before sharing." }, 400);
		const signature = cleanPersonalText(body?.signature, MAX_SIGNATURE_LENGTH);
		const problem = personalTextProblem(personalLine) ?? personalTextProblem(signature);
		if (problem) return json({ error: problem }, 400);
		if (!isReflection && personalLine && !signature) return json({ error: "Add your name under your words." }, 400);
		const matchesPreview = (card: typeof draft) => card.personalLine === personalLine && card.signature === signature &&
			JSON.stringify(reflectionPresentation(card.presentation)) === JSON.stringify(reflectionPresentation(body?.presentation));
		if (draft.publishedAt) {
			if (isReflection && !matchesPreview(draft)) return json({ error: "This link belongs to a different shared version. Start a new reflection." }, 409);
			return json({ id: draftId, url: personalCardUrl(draftId) });
		}
		// An edited reflection must be saved and previewed first. Publishing never
		// swaps the visible draft for words or typography the sender has not seen.
		if (isReflection && !matchesPreview(draft)) {
			return json({ error: "Preview your latest words before sharing." }, 409);
		}

		// Its link unfurls as the wide card, so a card that cannot draw whole at
		// every size is refused here rather than shared without a preview.
		const content = await personalCardContent(draftId, { ...draft, personalLine, signature });
		if (!cardFitsEverySize(content)) {
			return json({ error: "That's a little long for the card. Shorten your words and try again." }, 422);
		}

		const sent = await prisma.sharedCard.updateMany({
			where: { id: draftId, userId, kind: { in: ["word", "reflection"] }, revokedAt: null, publishedAt: null,
				...(isReflection ? { personalLine, signature, presentation: { equals: { ...reflectionPresentation(body?.presentation) } } } : {}) },
			data: { personalLine, signature, publishedAt: new Date() },
		});
		// Lost a race with another publish of the same draft: that one stands.
		if (sent.count === 0) {
			const current = await prisma.sharedCard.findFirst({
				where: { id: draftId, userId, revokedAt: null, publishedAt: { not: null } },
				select: { ...PERSONAL_CARD_SELECT, publishedAt: true },
			});
			if (!current) return json({ error: "Preview your latest words before sharing." }, 409);
			if (isReflection && !matchesPreview(current)) return json({ error: "This link belongs to a different shared version. Start a new reflection." }, 409);
		}
		return json({ id: draftId, url: personalCardUrl(draftId) });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Publishing a personal card failed:", error);
		return json({ error: "That card couldn't be saved. Try again." }, 500);
	}
}

export async function GET() {
	try {
		const userId = await getAuthUser();
		const rows = await prisma.sharedCard.findMany({
			where: { userId, publishedAt: { not: null } },
			orderBy: { createdAt: "desc" },
			take: 200,
			select: { id: true, kind: true, reference: true, recipient: true, createdAt: true, revokedAt: true },
		});
		return json({ cards: rows.map((row) => ({ ...row, url: personalCardUrl(row.id) })) });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Listing personal cards failed:", error);
		return json({ error: "Your cards couldn't be loaded." }, 500);
	}
}
