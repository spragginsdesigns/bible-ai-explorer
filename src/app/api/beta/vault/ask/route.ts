import { requireBetaApi } from "@/lib/beta/access";
import { CONSENT_DECLINED_NOTICE } from "@/lib/ai-consent-gate";
import { AiCredentialError } from "@/lib/ai/provider";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { IncludedAiLimitError } from "@/lib/billing/usage-errors";
import { hasCurrentAiConsent } from "@/lib/preferences-contract";
import { prisma } from "@/lib/prisma";
import { askVault, VAULT_QUESTION_MAX } from "@/lib/beta/vault/ask";
import { vaultFailure, vaultJson } from "@/lib/beta/vault/http";
import { parseVaultFilters } from "@/lib/beta/vault/vault-rules";

/**
 * POST /api/beta/vault/ask `{ question, kind?, from?, to?, passage?, topic? }`:
 * "Ask your study history" (docs/beta/vault.md). Answered only from the
 * founder's own vault, every point citing the sources it came from; nothing
 * is stored. A question with nothing in the vault to answer it costs no model
 * call. Runs only when the founder asks, on the house model, metered like any
 * included AI request, and only for an account that has agreed to AI.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The gate runs first, outside the metering wrapper, so anyone off the list gets
// the ordinary 404 whatever headers they send.
const metered = withIncludedAiRequest(handlePost, "beta-vault-ask");

export async function POST(req: Request): Promise<Response> {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	return metered(req, gate.userId);
}

async function handlePost(req: Request, userId: string): Promise<Response> {
	try {
		const body: unknown = await req.json().catch(() => null);
		const data = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
		const question = typeof data.question === "string" ? data.question.replace(/\s+/g, " ").trim() : "";
		if (!question) return vaultJson({ error: "Ask a question about what you have studied." }, 400);
		if (question.length > VAULT_QUESTION_MAX) return vaultJson({ error: `Keep the question under ${VAULT_QUESTION_MAX} characters.` }, 400);
		const user = await prisma.user.findUnique({ where: { id: userId }, select: { aiConsentVersion: true, aiConsentAt: true } });
		if (!hasCurrentAiConsent(user)) return vaultJson({ error: CONSENT_DECLINED_NOTICE, code: "AI_CONSENT_REQUIRED" }, 403);
		const filters = parseVaultFilters((name) => (typeof data[name] === "string" ? (data[name] as string) : null));
		return vaultJson(await askVault(userId, question, filters));
	} catch (error) {
		if (error instanceof IncludedAiLimitError) throw error;
		if (error instanceof AiCredentialError) return vaultJson({ error: error.message }, 403);
		return vaultFailure(error, "/ask", "Your question could not be answered just now. Please try again.");
	}
}
