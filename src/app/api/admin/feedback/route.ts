import { NextResponse } from "next/server";
import { currentAdminUserId, loadReviewPage, setReviewed } from "@/lib/admin/feedback-review";
import { parseMarkReviewed, parseReviewFilters } from "@/lib/admin/feedback-review-rules";

/**
 * The owner's review queue API (docs/FEATURES.md, "Reviewing reports").
 *
 * GET  ?type=all|rating|message&days=7|30|90&unreviewed=1|0&page=N
 *      -> one page of thumbs-down answers and Send feedback messages.
 * POST { kind: "rating" | "message", id, reviewed?: boolean }
 *      -> persists (or clears) the review mark.
 *
 * Anyone not in ADMIN_USER_IDS, signed in or out, gets the same 404 as a path
 * that does not exist. The middleware lets /api/admin through signed out for
 * exactly that reason; otherwise a stranger would get a 401 that admits it.
 */
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
	"Cache-Control": "private, no-store",
	"X-Robots-Tag": "noindex, nofollow",
};

function notFound() {
	return NextResponse.json({ error: "Not found" }, { status: 404, headers: PRIVATE_HEADERS });
}

export async function GET(req: Request) {
	if (!(await currentAdminUserId())) return notFound();
	const filters = parseReviewFilters(new URL(req.url).searchParams);
	try {
		const page = await loadReviewPage(filters);
		return NextResponse.json({ filters, ...page }, { headers: PRIVATE_HEADERS });
	} catch (error) {
		console.error("Admin feedback list failed:", error);
		return NextResponse.json({ error: "Could not load the queue." }, { status: 500, headers: PRIVATE_HEADERS });
	}
}

export async function POST(req: Request) {
	if (!(await currentAdminUserId())) return notFound();
	const parsed = parseMarkReviewed(await req.json().catch(() => null));
	if (!parsed.ok) {
		return NextResponse.json({ error: parsed.error }, { status: 400, headers: PRIVATE_HEADERS });
	}
	try {
		const updated = await setReviewed(parsed.data);
		if (!updated) return notFound();
		return NextResponse.json({ ok: true, ...parsed.data }, { headers: PRIVATE_HEADERS });
	} catch (error) {
		console.error("Admin feedback review failed:", error);
		return NextResponse.json({ error: "Could not save." }, { status: 500, headers: PRIVATE_HEADERS });
	}
}
