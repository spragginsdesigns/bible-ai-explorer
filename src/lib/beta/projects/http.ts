import "server-only";

import { NextResponse } from "next/server";
import { AiCredentialError } from "@/lib/ai/provider";
import { BETA_PRIVATE_HEADERS } from "@/lib/beta/access";
import { BetaStoreError } from "@/lib/beta/store";
import { ProjectAiError } from "@/lib/beta/projects/ai";
import { UploadError } from "@/lib/beta/projects/extract";
import { ProjectInputError } from "@/lib/beta/projects/projects";

/** Study Projects' JSON responses: private, never cached, never indexed. */
export function projectJson(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}

/** A request body as a plain object, or {} when it is not one. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
	const body: unknown = await req.json().catch(() => null);
	return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** Input problems are 400s with the message; a model that fails is a 502; anything else is logged. */
export function projectError(error: unknown, where: string): Response {
	if (error instanceof Response) return error;
	if (error instanceof ProjectInputError || error instanceof BetaStoreError || error instanceof UploadError) {
		return projectJson({ error: error.message }, 400);
	}
	if (error instanceof ProjectAiError) return projectJson({ error: error.message, code: "unavailable" }, 502);
	if (error instanceof AiCredentialError) return projectJson({ error: error.message }, 403);
	if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
		return projectJson({ error: "The assistant took too long. Try again.", code: "timeout" }, 504);
	}
	console.error(`[beta/projects] ${where} failed:`, error);
	return projectJson({ error: "Something went wrong. Try again." }, 500);
}
