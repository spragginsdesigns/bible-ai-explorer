import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { HouseModelUnavailableError } from "@/lib/ai/provider";
import { canonicalPassage } from "@/lib/bible/passage-context";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import { createRateLimiter } from "@/lib/rateLimit";
import { ensureEncouragement, readEncouragement } from "@/lib/share-cards/encouragement";
import { canonicalCardReference } from "@/lib/share-cards/reference";

/**
 * The encouragement line for a verse card (docs/FEATURES.md, "Share cards").
 *
 * POST /api/cards/encouragement { ref } -> { reference, text }
 *
 * Behind the session: this is the only place a line is ever written, so the
 * public card route can stay read-only and never spend a model call for a
 * stranger. A passage some reader already shared answers from the table at
 * once; only a first share calls the house model, and those are bounded per
 * account per hour.
 */
export const runtime = "nodejs";

const generationLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60_000 });

function json(body: unknown, status = 200): Response {
	return NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
	try {
		const userId = await getAuthUser();
		const body = (await request.json().catch(() => null)) as { ref?: unknown } | null;
		const input = typeof body?.ref === "string" ? body.ref.trim() : "";
		const parsed = input.length <= 60 ? canonicalCardReference(input) : null;
		if (!parsed) return json({ error: "Use one verse, or a short passage within one chapter." }, 400);

		const cached = await readEncouragement(parsed.label);
		if (cached) return json({ reference: parsed.label, text: cached });

		const rate = generationLimiter.check(userId);
		if (!rate.allowed) {
			return json({ error: "You've shared a lot of new verses this hour. Try again a little later." }, 429);
		}

		let kjvText: string;
		try {
			const passage = await canonicalPassage(parsed.label, "KJV");
			kjvText = passage.verses.map((row) => bibleVersePlainText(row.text)).join(" ");
		} catch {
			return json({ error: "That verse is not in this chapter." }, 400);
		}

		const text = await ensureEncouragement(parsed.label, kjvText);
		return json({ reference: parsed.label, text });
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof HouseModelUnavailableError) {
			return json({ error: "Encouragement isn't available right now. You can still share the verse." }, 503);
		}
		console.error("Encouragement failed:", error);
		return json({ error: "Encouragement isn't available right now. You can still share the verse." }, 502);
	}
}
