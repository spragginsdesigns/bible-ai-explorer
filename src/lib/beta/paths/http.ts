import "server-only";

import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS } from "@/lib/beta/access";
import type { PathsError } from "./server";

/** JSON with the beta's private, no-store headers. */
export function pathsJson(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}

export function pathsFailure(error: PathsError): NextResponse {
	return pathsJson({ error: error.error }, error.status);
}

export function pathsServerError(where: string, error: unknown): NextResponse {
	console.error(`[api/beta/paths/${where}]`, error);
	return pathsJson({ error: "Something went wrong. Please try again." }, 500);
}

export async function readBody(req: Request): Promise<unknown> {
	return req.json().catch(() => null);
}
