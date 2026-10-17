import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
	MAX_CARD_QUESTION_LENGTH,
	cardDateLabel,
	collapseWhitespace,
	verseDoor,
	parseShareCardFormat,
	parseShareCardSize,
	parseShareCardStyle,
} from "@/lib/share-cards/layout";
import { CardTooLongError, renderShareCard } from "@/lib/share-cards/render";
import { clipText } from "@/lib/shared-answer";

/**
 * The Pick Up Your Cross card (docs/FEATURES.md, "Share cards").
 *
 * GET /api/cards/cross/{verseOfDayId}?style=dawn&format=story&tz=America/Chicago
 *
 * Behind the session, owner-only: the day was chosen for one person, and its
 * "Carry this" question can be personal. The card shows the verse, the date
 * and that question only. "Why this verse today" is never drawn, because it
 * is built from the reader's own week (what they read, asked and wrote), and
 * a card is something they hand to other people.
 *
 * `tz` is the device's IANA zone, so the date on the card is the reader's
 * day rather than the server's; an unknown zone falls back to UTC.
 */
export const runtime = "nodejs";

const ID_PATTERN = /^[a-z0-9]{20,40}$/i;

/** A day's row never changes (a replaced day is a new row), so the client may keep it. */
const PRIVATE_CACHE = "private, max-age=86400";

function notFound(): Response {
	return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		if (!ID_PATTERN.test(id)) return notFound();

		const day = await prisma.verseOfDay.findFirst({
			where: { id, userId },
			select: { book: true, chapter: true, verse: true, text: true, question: true, sentAt: true },
		});
		if (!day) return notFound();

		const url = new URL(request.url);
		const timeZone = url.searchParams.get("tz")?.slice(0, 64) || undefined;
		const question = day.question?.trim()
			? clipText(collapseWhitespace(day.question), MAX_CARD_QUESTION_LENGTH)
			: null;

		return await renderShareCard(
			{
				kind: "cross",
				reference: `${day.book} ${day.chapter}:${day.verse}`,
				door: verseDoor(`${day.book} ${day.chapter}:${day.verse}`),
				translation: "KJV",
				text: day.text,
				dateLabel: cardDateLabel(day.sentAt, timeZone),
				question,
			},
			{
				style: parseShareCardStyle(url.searchParams.get("style")),
				format: parseShareCardFormat(url.searchParams.get("format")),
				size: parseShareCardSize(url.searchParams.get("size")),
				cacheControl: PRIVATE_CACHE,
			}
		);
	} catch (err) {
		if (err instanceof Response) return err;
		// A long verse with a long question can outgrow a small card; the
		// client offers another size rather than a clipped day.
		if (err instanceof CardTooLongError) {
			return NextResponse.json({ error: err.message }, { status: 422, headers: { "cache-control": "no-store" } });
		}
		console.error("Daily Cross card failed:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
