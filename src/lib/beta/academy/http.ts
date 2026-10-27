import "server-only";

import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS } from "@/lib/beta/access";

/** JSON with the beta's private, no-store headers (SureWord Academy, LC-17660). */
export function academyJson(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}

export function academyServerError(where: string, error: unknown): NextResponse {
	console.error(`[api/beta/academy/${where}]`, error);
	return academyJson({ error: "Something went wrong. Please try again." }, 500);
}

/** The `courseId` a request names: a short URL segment, or null. */
export function courseIdOf(value: unknown): string | null {
	return typeof value === "string" && /^[a-z0-9-]{1,60}$/.test(value) ? value : null;
}
