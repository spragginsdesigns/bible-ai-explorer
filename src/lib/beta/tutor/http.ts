import "server-only";

import { NextResponse } from "next/server";
import { AiCredentialError } from "@/lib/ai/provider";
import { BETA_PRIVATE_HEADERS } from "@/lib/beta/access";
import { BetaStoreError } from "@/lib/beta/store";
import { TutorUnavailableError } from "./tutor";

/** JSON with the beta's private headers, for every tutor route. */
export function tutorJson(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}

/** The one place a tutor route turns a thrown error into a response. */
export function tutorError(error: unknown, where: string): Response {
	if (error instanceof Response) return error;
	if (error instanceof AiCredentialError) return tutorJson({ error: error.message, code: "ai_unavailable" }, 403);
	if (error instanceof TutorUnavailableError) {
		return tutorJson({ error: "The tutor could not answer just now. Please try again.", code: "unavailable" }, 502);
	}
	if (error instanceof BetaStoreError) return tutorJson({ error: error.message, code: "invalid" }, 400);
	console.error(`tutor ${where} failed:`, error);
	return tutorJson({ error: "Something went wrong. Please try again." }, 500);
}

/** A JSON body as a plain object, or null when it is not one. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
	const body: unknown = await req.json().catch(() => null);
	return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
