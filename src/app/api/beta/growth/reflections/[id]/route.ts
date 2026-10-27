import { requireBetaApi } from "@/lib/beta/access";
import { deleteReflection, updateReflection } from "@/lib/beta/growth/growth";
import { growthBody, growthFailure, growthJson, growthNotFound } from "@/lib/beta/growth/http";

/** PATCH { text?, prompt?, passage? } and DELETE one journal entry. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		const entry = await updateReflection(gate.userId, id, await growthBody(request));
		return entry ? growthJson(entry) : growthNotFound();
	} catch (error) {
		return growthFailure(error, "/reflections/:id");
	}
}

export async function DELETE(_request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		return (await deleteReflection(gate.userId, id)) ? growthJson({ ok: true }) : growthNotFound();
	} catch (error) {
		return growthFailure(error, "/reflections/:id");
	}
}
