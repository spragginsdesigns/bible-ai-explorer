import { requireBetaApi } from "@/lib/beta/access";
import { recordPrayerOutcome, reopenPrayer } from "@/lib/beta/prayer/prayer";
import { prayerBody, prayerFailure, prayerJson, prayerNotFound } from "@/lib/beta/prayer/http";

/**
 * PUT { kind: "answered" | "closed", words, reflection?, confirmed: true } ->
 * the entry. Recorded only when the founder confirms it, in their own words.
 * DELETE -> pray on: the request reopens and the outcome's words become a
 * dated update.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		const entry = await recordPrayerOutcome(gate.userId, id, await prayerBody(request));
		return entry ? prayerJson(entry) : prayerNotFound();
	} catch (error) {
		return prayerFailure(error, "/:id/outcome");
	}
}

export async function DELETE(_request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		const entry = await reopenPrayer(gate.userId, id);
		return entry ? prayerJson(entry) : prayerNotFound();
	} catch (error) {
		return prayerFailure(error, "/:id/outcome");
	}
}
