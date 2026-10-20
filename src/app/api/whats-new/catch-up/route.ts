import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NEWEST_VERSION_CODE, WHATS_NEW_ENTRIES } from "@/lib/whats-new";
import { catchUpFor } from "@/lib/whats-new-rules";

/**
 * The "Since you were last here" sheet for the signed-in account.
 *
 * GET `?upTo=<versionCode>` caps the cards at what the calling build has
 * installed (Android and Apple send their own code; web sends nothing). The
 * first read for an account records the newest release as seen, so a new
 * account is never shown a catch-up.
 *
 * POST `{ versionCode }` records the sheet as dismissed. Seen only moves
 * forward and never past the newest published release.
 */
export const dynamic = "force-dynamic";

function parseCode(value: unknown): number | null {
	const n = typeof value === "string" ? Number(value) : value;
	return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: Request) {
	try {
		const userId = await getAuthUserId();
		const rawUpTo = new URL(req.url).searchParams.get("upTo");
		const upTo = rawUpTo === null ? null : parseCode(rawUpTo);
		// A malformed cap is refused rather than read as "no cap", which would
		// tell an old build about features it does not have.
		if (rawUpTo !== null && upTo === null) {
			return NextResponse.json({ error: "upTo must be a positive integer" }, { status: 400 });
		}
		const user = await prisma.user.findUnique({ where: { id: userId }, select: { whatsNewSeenCode: true } });
		const seen = user?.whatsNewSeenCode ?? null;
		const result = catchUpFor(WHATS_NEW_ENTRIES, seen, upTo);
		if (seen == null) {
			await prisma.user.updateMany({
				where: { id: userId, whatsNewSeenCode: null },
				data: { whatsNewSeenCode: NEWEST_VERSION_CODE },
			});
		}
		return NextResponse.json({ ...result, seenCode: seen ?? NEWEST_VERSION_CODE }, { headers: { "Cache-Control": "no-store" } });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/whats-new/catch-up] GET failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function POST(req: Request) {
	try {
		const userId = await getAuthUserId();
		const body: unknown = await req.json().catch(() => null);
		const requested = parseCode((body as { versionCode?: unknown } | null)?.versionCode);
		if (requested == null) {
			return NextResponse.json({ error: "versionCode must be a positive integer" }, { status: 400 });
		}
		const target = Math.min(requested, NEWEST_VERSION_CODE);
		// One conditional write, so two devices dismissing at once never move it backward.
		await prisma.user.updateMany({
			where: { id: userId, OR: [{ whatsNewSeenCode: null }, { whatsNewSeenCode: { lt: target } }] },
			data: { whatsNewSeenCode: target },
		});
		const user = await prisma.user.findUnique({ where: { id: userId }, select: { whatsNewSeenCode: true } });
		return NextResponse.json({ seenCode: user?.whatsNewSeenCode ?? target });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/whats-new/catch-up] POST failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
