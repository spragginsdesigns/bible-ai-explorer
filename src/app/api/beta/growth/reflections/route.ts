import { requireBetaApi } from "@/lib/beta/access";
import { createReflection, growthTimezone } from "@/lib/beta/growth/growth";
import { growthBody, growthFailure, growthJson, growthRequestTimezone } from "@/lib/beta/growth/http";

/**
 * POST /api/beta/growth/reflections?tz=<IANA> { text, prompt?, passage? } -> the entry.
 * Private: the words are kept only in the item's own data, out of what the
 * Knowledge Vault indexes, and never sent to an AI (docs/beta/growth.md).
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const timezone = await growthTimezone(gate.userId, growthRequestTimezone(request));
		return growthJson(await createReflection(gate.userId, await growthBody(request), timezone), 201);
	} catch (error) {
		return growthFailure(error, "/reflections");
	}
}
