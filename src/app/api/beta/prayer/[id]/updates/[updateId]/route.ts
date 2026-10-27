import { requireBetaApi } from "@/lib/beta/access";
import { deletePrayerUpdate } from "@/lib/beta/prayer/prayer";
import { prayerFailure, prayerJson, prayerNotFound } from "@/lib/beta/prayer/http";

/** DELETE one update from a request. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; updateId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id, updateId } = await params;
		return (await deletePrayerUpdate(gate.userId, id, updateId)) ? prayerJson({ ok: true }) : prayerNotFound();
	} catch (error) {
		return prayerFailure(error, "/:id/updates/:updateId");
	}
}
