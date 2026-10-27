import { requireBetaApi } from "@/lib/beta/access";
import { vaultFailure, vaultJson } from "@/lib/beta/vault/http";
import { searchVault } from "@/lib/beta/vault/search";
import { parseVaultFilters } from "@/lib/beta/vault/vault-rules";

/**
 * GET /api/beta/vault: the Knowledge Vault (docs/beta/vault.md). With no `q`,
 * the library newest first (`before` pages it); with `q`, full-text plus
 * meaning search. `kind` (comma list), `from`/`to` (YYYY-MM-DD), `passage`
 * ("John 3") and `topic` narrow either. Founders only; everyone else 404s.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const params = new URL(req.url).searchParams;
		return vaultJson(await searchVault(gate.userId, parseVaultFilters((name) => params.get(name))));
	} catch (error) {
		return vaultFailure(error, "", "Your vault could not be searched just now. Please try again.");
	}
}
