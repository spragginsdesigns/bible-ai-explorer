import "server-only";

import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, betaNotFound } from "@/lib/beta/access";
import { BetaStoreError } from "@/lib/beta/store";
import { GrowthInputError } from "@/lib/beta/growth/growth";

/** Shared plumbing for the /api/beta/growth routes; each route gates itself first. */

export function growthJson(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}

/** A missing or someone else's id: the same 404 as a path that does not exist. */
export const growthNotFound = betaNotFound;

export function growthFailure(error: unknown, route: string): NextResponse {
	if (error instanceof GrowthInputError || error instanceof BetaStoreError) return growthJson({ error: error.message }, 400);
	// Never the message: a Prisma error can quote the call's arguments, which may be a private reflection.
	const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
	console.error(`[api/beta/growth${route}] failed`, {
		name: error instanceof Error ? error.name : typeof error,
		code,
		stack: error instanceof Error ? error.stack?.split("\n").slice(1, 8).join("\n") : undefined,
	});
	return growthJson({ error: "Something went wrong. Please try again." }, 500);
}

/** The JSON object a write sends, or a 400 for anything else. */
export async function growthBody(request: Request): Promise<Record<string, unknown>> {
	const body: unknown = await request.json().catch(() => null);
	if (typeof body !== "object" || body === null || Array.isArray(body)) throw new GrowthInputError("Send a JSON object.");
	return body as Record<string, unknown>;
}

/** The browser's IANA timezone, sent as ?tz= on every call (the founder's calendar). */
export function growthRequestTimezone(request: Request): string | null {
	const value = new URL(request.url).searchParams.get("tz");
	return value && value.length <= 100 ? value : null;
}
