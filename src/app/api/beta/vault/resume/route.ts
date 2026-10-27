import { requireBetaApi } from "@/lib/beta/access";
import { vaultFailure, vaultJson } from "@/lib/beta/vault/http";
import { studyMemory } from "@/lib/beta/vault/resume";

/** GET /api/beta/vault/resume: the last study across the reader, chats, notes, Learn a verse and the beta modules. */
export const dynamic = "force-dynamic";

export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return vaultJson(await studyMemory(gate.userId));
	} catch (error) {
		return vaultFailure(error, "/resume", "Your last study could not be found just now.");
	}
}
