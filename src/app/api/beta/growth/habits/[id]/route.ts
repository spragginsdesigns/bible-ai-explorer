import { requireBetaApi } from "@/lib/beta/access";
import { deleteHabit, updateHabit } from "@/lib/beta/growth/growth";
import { growthBody, growthFailure, growthJson, growthNotFound } from "@/lib/beta/growth/http";

/** PATCH { name?, target?, reminder? } and DELETE one of the founder's habits. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		return (await updateHabit(gate.userId, id, await growthBody(request))) ? growthJson({ ok: true }) : growthNotFound();
	} catch (error) {
		return growthFailure(error, "/habits/:id");
	}
}

export async function DELETE(_request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		return (await deleteHabit(gate.userId, id)) ? growthJson({ ok: true }) : growthNotFound();
	} catch (error) {
		return growthFailure(error, "/habits/:id");
	}
}
