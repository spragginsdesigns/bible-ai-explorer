import { requireBetaApi } from "@/lib/beta/access";
import { vaultFailure, vaultJson } from "@/lib/beta/vault/http";
import { refreshVaultIndex } from "@/lib/beta/vault/meaning";

/**
 * POST /api/beta/vault/meaning: one more bounded step of bringing meaning
 * search up to date. The Vault page calls it only after the founder searched
 * or asked and the index reported sources still pending, and stops when a
 * step indexes nothing; there is no job behind it.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return vaultJson(await refreshVaultIndex(gate.userId));
	} catch (error) {
		return vaultFailure(error, "/meaning", "Meaning search could not be updated just now.");
	}
}
