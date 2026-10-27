import "server-only";

import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS } from "@/lib/beta/access";
import { BetaStoreError } from "@/lib/beta/store";

/** JSON for the Graph's routes: private, never cached, never indexed. */
export function graphJson(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}

/** Logged by name only, since errors can carry study text. */
export function graphFailure(error: unknown, route: string, message: string): Response {
	if (error instanceof BetaStoreError) return graphJson({ error: error.message }, 400);
	console.error(`[api/beta/graph${route}] failed`, error instanceof Error ? error.name : typeof error);
	return graphJson({ error: message }, 500);
}

/** A JSON object body, or an empty object for anything else. */
export async function readObject(req: Request): Promise<Record<string, unknown>> {
	const body: unknown = await req.json().catch(() => null);
	return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
