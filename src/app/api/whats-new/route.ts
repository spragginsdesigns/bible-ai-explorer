import { NextResponse } from "next/server";
import { WHATS_NEW_BEGINNING, WHATS_NEW_ENTRIES } from "@/lib/whats-new";

/**
 * Every published release, public and identical for everyone, so Android and
 * Apple can render What's new natively without an account. The content only
 * changes with a deploy, which is why it is static.
 */
export const dynamic = "force-static";

export function GET(): Response {
	return NextResponse.json(
		{ entries: WHATS_NEW_ENTRIES, beginning: WHATS_NEW_BEGINNING },
		{ headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
	);
}
