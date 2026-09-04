import { apiJson, type GetToken } from "@/lib/api";
import type { PreferencesPatch } from "./preferences";

/**
 * Account preferences transport. Both calls answer the full document, and both
 * are typed `unknown` on purpose: the payload goes through
 * `parsePreferencesDocument` so a server older or newer than this build can
 * never write an unchecked value into the local cache.
 */

export function fetchPreferences(getToken: GetToken): Promise<unknown> {
	return apiJson<unknown>(getToken, "/api/preferences");
}

export function patchPreferences(
	getToken: GetToken,
	patch: PreferencesPatch
): Promise<unknown> {
	return apiJson<unknown>(getToken, "/api/preferences", {
		method: "PATCH",
		body: patch,
	});
}
