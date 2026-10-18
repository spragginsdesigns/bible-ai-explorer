import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canonicalPassage } from "@/lib/bible/passage-context";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import { createSharedAnswerId } from "@/lib/shared-answer";
import { createRateLimiter } from "@/lib/rateLimit";
import { canonicalCardReference } from "@/lib/share-cards/reference";
import { cardTranslation } from "@/lib/share-cards/targets";
import { DEFAULT_REFLECTION_PRESENTATION } from "@/lib/share-cards/reflection-contract";

const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 60_000 });
export const runtime = "nodejs";

/** Creating an empty, owner-only draft uses no AI and never publishes anything. */
export async function POST(request: Request) {
	try {
		const userId = await getAuthUser();
		const body = await request.json().catch(() => null) as { reference?: unknown; translation?: unknown } | null;
		const reference = typeof body?.reference === "string" && body.reference.length <= 60 ? canonicalCardReference(body.reference) : null;
		const translation = typeof body?.translation === "string" ? cardTranslation(body.translation) : null;
		if (!reference || reference.end - reference.start >= 4 || !translation) {
			return NextResponse.json({ error: "Choose up to four verses in KJV, BSB or NKJV." }, { status: 400 });
		}
		if (!limiter.check(userId).allowed) return NextResponse.json({ error: "Too many drafts. Try again later." }, { status: 429 });
		const passage = await canonicalPassage(reference.label, translation);
		await prisma.sharedCard.deleteMany({ where: { userId, publishedAt: null, createdAt: { lt: new Date(Date.now() - 86_400_000) } } });
		const card = await prisma.sharedCard.create({ data: {
			id: createSharedAnswerId(), userId, kind: "reflection", reference: passage.reference, translation,
			presentation: { ...DEFAULT_REFLECTION_PRESENTATION },
		}, select: { id: true } });
		return NextResponse.json({ id: card.id, reference: passage.reference, translation,
			text: passage.verses.map(row => bibleVersePlainText(row.text)).join(" ") },
			{ headers: { "cache-control": "private, no-store" } });
	} catch (error) {
		if (error instanceof Response) return error;
		return NextResponse.json({ error: "The reflection couldn't be opened. Try again." }, { status: 502 });
	}
}
