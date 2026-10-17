import { prisma } from "@/lib/prisma";
import {
	SHARED_ANSWER_FALLBACK_TITLE,
	SHARED_CARD_CACHE_CONTROL,
	clipText,
	isSharedAnswerId,
	shareCardExcerpt,
} from "@/lib/shared-answer";
import { tagSharedCard } from "@/lib/shared-answer-cache";
import {
	MAX_CARD_QUESTION_LENGTH,
	SHARE_CARD_DESIGN_VERSION,
	collapseWhitespace,
	parseShareCardFormat,
	parseShareCardSize,
	parseShareCardStyle,
} from "@/lib/share-cards/layout";
import { renderShareCard } from "@/lib/share-cards/render";

/**
 * The card for a shared answer (docs/FEATURES.md, "Share an answer" and
 * "Share cards").
 *
 * With no query it is the 1200x630 unfurl: iMessage, WhatsApp, X and Discord
 * all fetch it signed-out, from their own scrapers, which is why
 * `/api/shared/(.*)/image` is in `isPublicRoute`. The share sheet asks for
 * the same card as a story or square image (`?format=story&style=parchment`)
 * to share the picture itself.
 *
 * It reads the SharedAnswer snapshot only - never Message - so a revoked link
 * stops drawing the moment it is revoked. Caches are the other half of that:
 * the card is never cached as long-lived (SHARED_CARD_CACHE_CONTROL), and its
 * CDN copy carries a per-share tag that revoking purges. Every format and
 * style of one share sits under the same tag, so one purge takes them all.
 *
 * Node runtime, because it reads Postgres through Prisma.
 */
export const runtime = "nodejs";

function notFound(): Response {
	return new Response("Not found", {
		status: 404,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!isSharedAnswerId(id)) return notFound();

	// The bare URL is the unfurl. Any other query has one spelling, and
	// everything else is redirected to it before the database or the
	// renderer is touched, so random query strings cannot force a render.
	const url = new URL(req.url);
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

	const share = await prisma.sharedAnswer.findFirst({
		where: { id, revokedAt: null },
		select: { question: true, answer: true, references: true },
	});
	if (!share) return notFound();
	// A no-op off Vercel, and never throws: a failed tag only loses the
	// instant purge, the short s-maxage still bounds a revoked card.
	await tagSharedCard(id);

	const references = Array.isArray(share.references)
		? share.references.filter((reference): reference is string => typeof reference === "string")
		: [];
	return renderShareCard(
		{
			kind: "answer",
			question:
				clipText(collapseWhitespace(share.question), MAX_CARD_QUESTION_LENGTH) ||
				SHARED_ANSWER_FALLBACK_TITLE,
			excerpt: shareCardExcerpt(share.answer),
			reference: references[0] ?? null,
		},
		{
			style,
			format,
			size,
			cacheControl: SHARED_CARD_CACHE_CONTROL,
		}
	);
}
