import "server-only";

import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { parseUserIdAllowlist } from "@/lib/entitlements-rules";
import { isBetaUserId } from "@/lib/beta/access-rules";

/**
 * The founders-only gate for SureWord Beta (docs/beta/README.md). Every beta
 * page and every /api/beta route goes through one of these three, before it
 * reads or writes anything.
 */

/** The signed-in founder's Clerk id, or null for everyone else. */
export async function currentBetaUserId(): Promise<string | null> {
	const { userId } = await auth();
	return isBetaUserId(userId, parseUserIdAllowlist(process.env.BETA_USER_IDS)) ? userId : null;
}

/**
 * A beta layout's or page's metadata, for founders only. Next resolves
 * metadata even when the layout calls notFound(), so a static `metadata`
 * export would title everyone else's 404 "Study Projects | SureWord Beta".
 * Off the list, this returns nothing and the 404 matches any other.
 */
export async function betaMetadata(metadata: Metadata): Promise<Metadata> {
	return (await currentBetaUserId()) ? metadata : {};
}

/** For server pages and layouts: the founder's id, or the ordinary 404. */
export async function requireBetaPage(): Promise<string> {
	const userId = await currentBetaUserId();
	if (!userId) notFound();
	return userId;
}

export const BETA_PRIVATE_HEADERS = {
	"Cache-Control": "private, no-store",
	"X-Robots-Tag": "noindex, nofollow",
} as const;

/** The same 404 body and headers as a path that does not exist. */
export function betaNotFound(): NextResponse {
	return NextResponse.json({ error: "Not found" }, { status: 404, headers: BETA_PRIVATE_HEADERS });
}

/**
 * For /api/beta route handlers:
 *
 *     const gate = await requireBetaApi();
 *     if (!gate.ok) return gate.response;
 *     // gate.userId is a founder
 */
export async function requireBetaApi(): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
	const userId = await currentBetaUserId();
	return userId ? { ok: true, userId } : { ok: false, response: betaNotFound() };
}
