import { requireBetaApi } from "@/lib/beta/access";
import { growthOverview, growthTimezone } from "@/lib/beta/growth/growth";
import { growthFailure, growthJson, growthRequestTimezone } from "@/lib/beta/growth/http";

/**
 * GET /api/beta/growth?tz=<IANA>&week=<YYYY-MM-DD> -> the Habits & Reflection
 * page for one week (this week by default): the founder's habits counted for
 * that week, the day row, the weeks before it, the journal and what they are
 * putting into practice (docs/beta/growth.md).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const timezone = await growthTimezone(gate.userId, growthRequestTimezone(request));
		const week = new URL(request.url).searchParams.get("week");
		return growthJson(await growthOverview(gate.userId, { timezone, week }));
	} catch (error) {
		return growthFailure(error, "");
	}
}
