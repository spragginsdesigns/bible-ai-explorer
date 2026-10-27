import { requireBetaApi } from "@/lib/beta/access";
import { prayerOverview } from "@/lib/beta/prayer/prayer";
import { prayerFailure, prayerJson, prayerRequestTimezone } from "@/lib/beta/prayer/http";

/**
 * GET /api/beta/prayer?tz=<IANA> -> { today, requests, timeline }: the
 * founder's own prayer list with what grew around each request, and the
 * testimony timeline, oldest first by month (docs/beta/prayer.md). New
 * requests are added through the ordinary prayer list (POST /api/memories).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return prayerJson(await prayerOverview(gate.userId, { timezone: prayerRequestTimezone(request) }));
	} catch (error) {
		return prayerFailure(error, "");
	}
}
