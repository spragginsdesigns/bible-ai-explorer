import { requireBetaApi } from "@/lib/beta/access";
import { deletePrayerEntry, setPrayerDetails } from "@/lib/beta/prayer/prayer";
import { prayerBody, prayerFailure, prayerJson, prayerNotFound, prayerRequestTimezone } from "@/lib/beta/prayer/http";

/**
 * One prayer request, by its prayer list id.
 * PATCH ?tz= { passages?: string[], remindOn?: "YYYY-MM-DD" | null } -> the entry.
 * DELETE -> removes its testimony (updates, passages, reminder, outcome); the
 * prayer list row itself is untouched.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		const entry = await setPrayerDetails(gate.userId, id, await prayerBody(request), prayerRequestTimezone(request));
		return entry ? prayerJson(entry) : prayerNotFound();
	} catch (error) {
		return prayerFailure(error, "/:id");
	}
}

export async function DELETE(_request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		return (await deletePrayerEntry(gate.userId, id)) ? prayerJson({ ok: true }) : prayerNotFound();
	} catch (error) {
		return prayerFailure(error, "/:id");
	}
}
