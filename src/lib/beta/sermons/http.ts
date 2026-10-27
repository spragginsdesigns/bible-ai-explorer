import "server-only";

import { NextResponse } from "next/server";
import { AiCredentialError } from "@/lib/ai/provider";
import { BETA_PRIVATE_HEADERS } from "@/lib/beta/access";
import { SermonsUnavailableError, type SermonsError } from "./server";

/** JSON with the beta's private, no-store headers. */
export function sermonsJson(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}

export function sermonsFailure(error: SermonsError): NextResponse {
	return sermonsJson({ error: error.error }, error.status);
}

/** A thrown error as the browser sees it; the details stay in the server log. */
export function sermonsServerError(where: string, error: unknown, unavailable: string): NextResponse {
	if (error instanceof AiCredentialError) return sermonsJson({ error: error.message }, 403);
	console.error(`[api/beta/sermons/${where}]`, error);
	if (error instanceof SermonsUnavailableError || (error instanceof Error && /abort|timeout/i.test(error.name + error.message))) {
		return sermonsJson({ error: unavailable }, 502);
	}
	return sermonsJson({ error: "Something went wrong. Please try again." }, 500);
}

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
	const body = await req.json().catch(() => null);
	return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
