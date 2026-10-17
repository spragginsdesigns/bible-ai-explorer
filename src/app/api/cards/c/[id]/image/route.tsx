import { prisma } from "@/lib/prisma";
import { SHARED_CARD_CACHE_CONTROL, isSharedAnswerId } from "@/lib/shared-answer";
import { tagSharedCard } from "@/lib/shared-answer-cache";
import {
	SHARE_CARD_DESIGN_VERSION,
	parseShareCardFormat,
	parseShareCardSize,
	parseShareCardStyle,
} from "@/lib/share-cards/layout";
import { PERSONAL_CARD_SELECT, personalCardContent } from "@/lib/share-cards/personal";
import { CardTooLongError, renderShareCard } from "@/lib/share-cards/render";

/**
 * A personal card's image (docs/FEATURES.md, "Share cards" -> "Send a word").
 *
 * GET /api/cards/c/{id}/image[?style&format[&size=preview]&v]
 *
 * Public, like a shared answer's card: the 16-character id is the
 * capability, and the bare URL is the page's 1200x630 unfurl. Only a
 * published, unrevoked SharedCard draws; the verse text is looked up by the
 * server, never stored or taken from the caller. Revocable, so cached under
 * SHARED_CARD_CACHE_CONTROL (browsers revalidate, the CDN holds five minutes)
 * with the per-id tag a revoke purges. A query in any spelling but the
 * canonical one is redirected before the database is touched.
 */
export const runtime = "nodejs";

function plain(status: number, message: string): Response {
	return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!isSharedAnswerId(id)) return plain(404, "Not found");

	const url = new URL(request.url);
	const style = parseShareCardStyle(url.searchParams.get("style"));
	const format = parseShareCardFormat(url.searchParams.get("format"), "wide");
	const size = parseShareCardSize(url.searchParams.get("size"));
	if (url.search) {
		const canonical = new URLSearchParams({ style, format });
		if (size === "preview") canonical.set("size", "preview");
		canonical.set("v", SHARE_CARD_DESIGN_VERSION);
		if (url.search !== `?${canonical.toString()}`) {
			return new Response(null, {
				status: 308,
				headers: { location: `${url.pathname}?${canonical.toString()}`, "cache-control": SHARED_CARD_CACHE_CONTROL },
			});
		}
	}

	const card = await prisma.sharedCard.findFirst({
		where: { id, revokedAt: null, publishedAt: { not: null } },
		select: PERSONAL_CARD_SELECT,
	});
	if (!card) return plain(404, "Not found");
	await tagSharedCard(id);

	let content: Awaited<ReturnType<typeof personalCardContent>>;
	try {
		content = await personalCardContent(id, card);
	} catch (error) {
		console.error("Personal card text failed to load:", error);
		return plain(502, "That passage could not be loaded. Try again.");
	}

	try {
		return await renderShareCard(
			content,
			{ style, format, size, cacheControl: SHARED_CARD_CACHE_CONTROL }
		);
	} catch (error) {
		if (error instanceof CardTooLongError) return plain(422, error.message);
		throw error;
	}
}
