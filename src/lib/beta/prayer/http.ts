import "server-only";

import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, betaNotFound } from "@/lib/beta/access";
import { BetaStoreError } from "@/lib/beta/store";
import { PrayerInputError, prayerTimezone } from "@/lib/beta/prayer/prayer";

/** Shared plumbing for the /api/beta/prayer routes; each route gates itself first. */

export function prayerJson(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}

/** A missing or someone else's prayer: the same 404 as a path that does not exist. */
export const prayerNotFound = betaNotFound;

export function prayerFailure(error: unknown, route: string): NextResponse {
	if (error instanceof PrayerInputError || error instanceof BetaStoreError) return prayerJson({ error: error.message }, 400);
	// Never the message: a Prisma error can quote the call's arguments, which may be a private prayer.
	const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
	console.error(`[api/beta/prayer${route}] failed`, {
		name: error instanceof Error ? error.name : typeof error,
		code,
		stack: error instanceof Error ? error.stack?.split("\n").slice(1, 8).join("\n") : undefined,
	});
	return prayerJson({ error: "Something went wrong. Please try again." }, 500);
}

/** The JSON object a write sends, or a 400 for anything else. */
export async function prayerBody(request: Request): Promise<Record<string, unknown>> {
	const body: unknown = await request.json().catch(() => null);
	if (typeof body !== "object" || body === null || Array.isArray(body)) throw new PrayerInputError("Send a JSON object.");
	return body as Record<string, unknown>;
}

/** The founder's calendar, from the browser's IANA timezone sent as ?tz=. */
export function prayerRequestTimezone(request: Request): string {
	const value = new URL(request.url).searchParams.get("tz");
	return prayerTimezone(value && value.length <= 100 ? value : null);
}
