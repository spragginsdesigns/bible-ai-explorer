import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { checkTeaching } from "@/lib/beta/verify/engine";
import { VERIFY_TEXT_MAX } from "@/lib/beta/verify/verify-rules";

/**
 * POST /api/beta/verify/check { text } -> { report }
 * Scripture Check (LC-17649, docs/beta/verify.md): every reference and marked
 * quotation in the teaching, checked against the bundled KJV and BSB. Purely
 * deterministic, no model and no spend; nothing is stored.
 * Founders only (docs/beta/README.md); everyone else gets the ordinary 404.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const body: unknown = await req.json().catch(() => null);
	const text = typeof body === "object" && body !== null && "text" in body && typeof body.text === "string" ? body.text : null;
	if (text === null || !text.trim()) return json({ error: "Paste a sermon, devotional or answer to check.", code: "empty" }, 400);
	if (text.length > VERIFY_TEXT_MAX) {
		return json({ error: `That is longer than ${VERIFY_TEXT_MAX.toLocaleString("en-US")} characters. Check it in parts.`, code: "too_long" }, 413);
	}
	try {
		return json({ report: await checkTeaching(text) });
	} catch (error) {
		console.error("verify check failed:", error);
		return json({ error: "The check could not finish. Please try again." }, 500);
	}
}
