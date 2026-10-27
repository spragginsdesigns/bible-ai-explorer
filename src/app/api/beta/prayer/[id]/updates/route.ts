import { requireBetaApi } from "@/lib/beta/access";
import { addPrayerUpdate } from "@/lib/beta/prayer/prayer";
import { prayerBody, prayerFailure, prayerJson, prayerNotFound, prayerRequestTimezone } from "@/lib/beta/prayer/http";

/** POST ?tz= { text } -> the entry, with a dated update added to the request. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		const entry = await addPrayerUpdate(gate.userId, id, await prayerBody(request), prayerRequestTimezone(request));
		return entry ? prayerJson(entry, 201) : prayerNotFound();
	} catch (error) {
		return prayerFailure(error, "/:id/updates");
	}
}
