import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { isSharedAnswerId, shareCardExcerpt } from "@/lib/shared-answer";

/**
 * The unfurl card for a shared answer (docs/FEATURES.md, "Share an answer").
 *
 * This is the "share as image" most people actually experience: iMessage,
 * WhatsApp, X and Discord all fetch this signed-out, from their own scrapers,
 * which is why `/api/shared/(.*)/image` is in `isPublicRoute`. It reads the
 * SharedAnswer snapshot only - never Message - so a revoked link stops
 * unfurling the moment it is revoked.
 *
 * No `fonts` option is passed on purpose. next/og replaces the bundled default
 * face outright when one is supplied (`options.fonts || defaultFonts` in
 * @vercel/og), so shipping a serif for the reference line would have rendered
 * the whole card in it, and fetching a face at request time would add a
 * network failure mode to a route that cannot be exercised locally on Windows
 * (see `vercel-og-windows-broken` in memory). The reference is set apart by
 * size, colour and italics instead.
 *
 * Node runtime, because it reads Postgres through Prisma.
 */
export const runtime = "nodejs";

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

const SHELL = "#0a0a0a";
const GOLD = "#fbbf24";
const GOLD_DEEP = "#f59e0b";
const GOLD_PALE = "#fde68a";
const BODY_TEXT = "#e9e6df";
const MUTED_TEXT = "#8f8a80";

function notFound(): Response {
	return new Response("Not found", {
		status: 404,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!isSharedAnswerId(id)) return notFound();

	const share = await prisma.sharedAnswer.findFirst({
		where: { id, revokedAt: null },
		select: { answer: true, references: true, translation: true },
	});
	if (!share) return notFound();

	const references = Array.isArray(share.references)
		? share.references.filter((reference): reference is string => typeof reference === "string")
		: [];
	const headline = references[0] ?? share.translation;
	const excerpt = shareCardExcerpt(share.answer);

	return new ImageResponse(
		(
			<div
				style={{
					width: CARD_WIDTH,
					height: CARD_HEIGHT,
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					backgroundColor: SHELL,
					padding: "60px 72px",
					color: BODY_TEXT,
				}}
			>
				<div style={{ display: "flex", alignItems: "center" }}>
					{/* The day star rising over the open Word, in the shapes satori
					    renders reliably: a gold disc above two gold rules. */}
					<div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 72 }}>
						<div
							style={{
								display: "flex",
								width: 38,
								height: 38,
								borderRadius: 19,
								backgroundImage: `linear-gradient(180deg, ${GOLD_PALE} 0%, ${GOLD_DEEP} 100%)`,
							}}
						/>
						<div
							style={{
								display: "flex",
								width: 72,
								height: 7,
								marginTop: 12,
								borderRadius: 4,
								backgroundColor: GOLD,
							}}
						/>
						<div
							style={{
								display: "flex",
								width: 52,
								height: 5,
								marginTop: 6,
								borderRadius: 3,
								backgroundColor: GOLD,
								opacity: 0.5,
							}}
						/>
					</div>
					<div
						style={{
							display: "flex",
							marginLeft: 26,
							fontSize: 34,
							letterSpacing: 6,
							color: GOLD,
						}}
					>
						SUREWORD
					</div>
				</div>

				<div style={{ display: "flex", flexDirection: "column" }}>
					<div
						style={{
							display: "flex",
							fontSize: 44,
							fontStyle: "italic",
							letterSpacing: 1,
							color: GOLD,
						}}
					>
						{headline}
					</div>
					<div
						style={{
							display: "flex",
							width: 120,
							height: 3,
							marginTop: 26,
							marginBottom: 26,
							backgroundColor: GOLD,
							opacity: 0.45,
						}}
					/>
					<div style={{ display: "flex", fontSize: 34, lineHeight: 1.4, color: BODY_TEXT }}>
						{excerpt}
					</div>
				</div>

				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
					<div style={{ display: "flex", fontSize: 24, color: MUTED_TEXT }}>
						Shared from SureWord
					</div>
					<div style={{ display: "flex", fontSize: 24, color: MUTED_TEXT }}>sureword.app</div>
				</div>
			</div>
		),
		{
			width: CARD_WIDTH,
			height: CARD_HEIGHT,
			// Lowercase on purpose: next/og sets its own immutable one-year
			// "cache-control" key and spreads `options.headers` over it. A
			// "Cache-Control" spelling would be a SECOND header entry rather than
			// a replacement, and the two values would be concatenated.
			headers: { "cache-control": "public, max-age=86400, s-maxage=86400" },
		},
	);
}
