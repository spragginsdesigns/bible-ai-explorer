import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSharedAnswerId } from "@/lib/shared-answer";
import { parseShareCardFormat, parseShareCardSize, parseShareCardStyle } from "@/lib/share-cards/layout";
import { PERSONAL_CARD_SELECT, personalCardContent } from "@/lib/share-cards/personal";
import { CardTooLongError, renderShareCard } from "@/lib/share-cards/render";

/**
 * The sender's own preview of a personal card, draft or sent
 * (docs/FEATURES.md, "Share cards" -> "Send a word").
 *
 * GET /api/cards/personal/{id}/image?style&format[&size=preview][&t=<edit>]
 *
 * Behind the session and owner-only, so it may draw a draft nobody else can
 * see. Never cached by anyone (the line changes as the sender types); the
 * Send a word sheet adds `t` so its own file cache follows each edit. The
 * public image of a sent card is /api/cards/c/{id}/image.
 */
export const runtime = "nodejs";

function plain(status: number, message: string): Response {
	return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		if (!isSharedAnswerId(id)) return plain(404, "Not found");
		const card = await prisma.sharedCard.findFirst({
			where: { id, userId, revokedAt: null },
			select: PERSONAL_CARD_SELECT,
		});
		if (!card) return plain(404, "Not found");

		const url = new URL(request.url);
		const content = await personalCardContent(id, card);
		return await renderShareCard(content, {
			style: parseShareCardStyle(url.searchParams.get("style")),
			format: parseShareCardFormat(url.searchParams.get("format")),
			size: parseShareCardSize(url.searchParams.get("size")),
			cacheControl: "private, no-store",
		});
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof CardTooLongError) return plain(422, error.message);
		console.error("Personal card preview failed:", error);
		return plain(500, "The preview didn't load.");
	}
}
