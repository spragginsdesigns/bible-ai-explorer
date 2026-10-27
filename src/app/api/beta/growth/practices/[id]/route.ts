import { requireBetaApi } from "@/lib/beta/access";
import { actOnPractice, deletePractice, growthTimezone } from "@/lib/beta/growth/growth";
import { checkPracticeAction } from "@/lib/beta/growth/growth-rules";
import { growthBody, growthFailure, growthJson, growthNotFound, growthRequestTimezone } from "@/lib/beta/growth/http";

/**
 * PATCH /api/beta/growth/practices/:id?tz=<IANA> with one action:
 *   { action: "follow-up", note?, next }  how it has gone, and when to ask again
 *   { action: "later" }                   ask again tomorrow
 *   { action: "lived", note? }            it has become part of them
 *   { action: "reopen", next? }           back to practising
 * DELETE removes it.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		const action = checkPracticeAction(await growthBody(request));
		if (!action.ok) return growthJson({ error: action.error }, 400);
		const timezone = await growthTimezone(gate.userId, growthRequestTimezone(request));
		const practice = await actOnPractice(gate.userId, id, action.value, timezone);
		return practice ? growthJson(practice) : growthNotFound();
	} catch (error) {
		return growthFailure(error, "/practices/:id");
	}
}

export async function DELETE(_request: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		return (await deletePractice(gate.userId, id)) ? growthJson({ ok: true }) : growthNotFound();
	} catch (error) {
		return growthFailure(error, "/practices/:id");
	}
}
