import "server-only";

import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS } from "@/lib/beta/access";
import { errorTag, VaultInputError } from "@/lib/beta/vault/search";

/** JSON for the Vault's routes: private, never cached, never indexed. */
export function vaultJson(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}

/** A bad filter is the caller's to fix (400); anything else is logged by name only, since errors can carry study text. */
export function vaultFailure(error: unknown, route: string, message: string): Response {
	if (error instanceof Response) return error;
	if (error instanceof VaultInputError) return vaultJson({ error: error.message }, 400);
	console.error(`[api/beta/vault${route}] failed`, errorTag(error));
	return vaultJson({ error: message }, 500);
}
