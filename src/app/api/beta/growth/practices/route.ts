import { requireBetaApi } from "@/lib/beta/access";
import { createPractice, growthTimezone } from "@/lib/beta/growth/growth";
import { growthBody, growthFailure, growthJson, growthRequestTimezone } from "@/lib/beta/growth/http";

/**
 * POST /api/beta/growth/practices?tz=<IANA> { text, passage?, followUp?, reflectionId? }
 * Something the founder chose to put into practice. `followUp` is
 * "none" | "3d" | "1w" | "2w" | "1m" (a week when omitted); when its day
 * comes, the page asks how it has gone.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const timezone = await growthTimezone(gate.userId, growthRequestTimezone(request));
		return growthJson(await createPractice(gate.userId, await growthBody(request), timezone), 201);
	} catch (error) {
		return growthFailure(error, "/practices");
	}
}
