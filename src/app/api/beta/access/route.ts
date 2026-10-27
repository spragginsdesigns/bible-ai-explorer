import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, currentBetaUserId } from "@/lib/beta/access";

/**
 * GET /api/beta/access -> { beta: boolean } for the signed-in account
 * (docs/beta/README.md). The one /api/beta route open to every account: the
 * app's options menu asks it, only when opened, whether to show the way into
 * SureWord Beta. It reads nothing but the session and BETA_USER_IDS. Every
 * other /api/beta route answers 404 to anyone off the list.
 */
export const dynamic = "force-dynamic";

export async function GET() {
	const userId = await currentBetaUserId();
	return NextResponse.json({ beta: Boolean(userId) }, { headers: BETA_PRIVATE_HEADERS });
}
