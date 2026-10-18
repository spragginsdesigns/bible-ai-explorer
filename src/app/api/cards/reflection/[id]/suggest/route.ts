import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSharedAnswerId } from "@/lib/shared-answer";
import { createRateLimiter } from "@/lib/rateLimit";
import { draftWalkReflection, ReflectionUnavailableError } from "@/lib/share-cards/reflection";

export const runtime = "nodejs";
export const maxDuration = 90;
const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60_000 });
function json(body: unknown, status = 200) {
	return NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

/** Explicit AI action. The result is private draft text, never a public URL or source records. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		if (!isSharedAnswerId(id)) return json({ error: "Not found" }, 404);
		const card = await prisma.sharedCard.findFirst({ where: { id, userId, kind: "reflection", publishedAt: null, revokedAt: null }, select: { reference: true } });
		if (!card) return json({ error: "Not found" }, 404);
		if (!limiter.check(userId).allowed) return json({ error: "You've requested several reflections. Write your own words or try again later." }, 429);
		const text = await draftWalkReflection(userId, card.reference);
		return json({ text, personalized: true });
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof ReflectionUnavailableError) return json({ error: error.message }, 422);
		// Provider exceptions can contain prompts or records. No raw error is logged or returned.
		return json({ error: "SureWord couldn't safely draft this reflection. You can write your own words." }, 502);
	}
}
