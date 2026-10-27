import "server-only";

import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS } from "@/lib/beta/access";

/** The largest request body a maps route reads; a full map is well under 100 KB. */
const BODY_MAX_BYTES = 300_000;

/** The JSON body as an object, or null when it is missing, too large or not an object. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
	const text = await req.text().catch(() => "");
	if (!text || text.length > BODY_MAX_BYTES) return null;
	try {
		const value: unknown = JSON.parse(text);
		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

export function mapsJson(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}
