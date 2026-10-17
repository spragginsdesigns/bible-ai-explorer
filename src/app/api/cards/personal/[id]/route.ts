import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSharedAnswerId } from "@/lib/shared-answer";
import { purgeSharedCards } from "@/lib/shared-answer-cache";
import {
	MAX_PERSONAL_LINE_LENGTH,
	MAX_SIGNATURE_LENGTH,
	PERSONAL_CARD_SELECT,
	cleanPersonalText,
	personalCardContent,
	personalTextProblem,
} from "@/lib/share-cards/personal";
import { cardFitsEverySize } from "@/lib/share-cards/render";

/**
 * One personal card, owner-only (docs/FEATURES.md, "Share cards" -> "Send a
 * word"). Somebody else's id is a 404, never a 403, so it confirms nothing.
 */
export const runtime = "nodejs";

function notFound(): Response {
	return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * PATCH /api/cards/personal/{id} { personalLine, signature } -> { ok: true, fits }
 *
 * The sender's own line and name on a draft, saved as they type so the
 * preview can draw them. One conditional write on an unsent draft: a save
 * that arrives after the card was sent (a debounce racing the Share tap) is
 * refused with 409 rather than rewriting what was already shared.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		if (!isSharedAnswerId(id)) return notFound();
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		const personalLine = cleanPersonalText(body?.personalLine, MAX_PERSONAL_LINE_LENGTH);
		const signature = cleanPersonalText(body?.signature, MAX_SIGNATURE_LENGTH);
		const problem = personalTextProblem(personalLine) ?? personalTextProblem(signature);
		if (problem) return NextResponse.json({ error: problem }, { status: 400 });

		const saved = await prisma.sharedCard.updateMany({
			where: { id, userId, revokedAt: null, publishedAt: null },
			data: { personalLine, signature },
		});
		if (saved.count === 0) {
			const sent = await prisma.sharedCard.findFirst({ where: { id, userId, revokedAt: null }, select: { id: true } });
			if (!sent) return notFound();
			return NextResponse.json({ error: "This card was already sent." }, { status: 409 });
		}
		// `fits` lets the sheet hold Share until the card draws whole at every
		// size, so a link is never shared for a card that publishing refuses.
		const card = await prisma.sharedCard.findFirst({ where: { id, userId }, select: PERSONAL_CARD_SELECT });
		const fits = card ? cardFitsEverySize(await personalCardContent(id, card)) : false;
		return NextResponse.json({ ok: true, fits });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Updating a personal card failed:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * DELETE /api/cards/personal/{id} -> { ok: true }
 *
 * Take a card back. The row is stamped rather than deleted, like a shared
 * answer, and the CDN copy of its image is purged under the same per-id
 * cache tag. Idempotent.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		if (!isSharedAnswerId(id)) return notFound();
		const card = await prisma.sharedCard.findFirst({ where: { id, userId }, select: { id: true, revokedAt: true } });
		if (!card) return notFound();
		if (!card.revokedAt) {
			await prisma.sharedCard.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
		}
		await purgeSharedCards([id]);
		return NextResponse.json({ ok: true });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Revoking a personal card failed:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
