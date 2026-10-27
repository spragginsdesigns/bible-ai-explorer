import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { projectError, projectJson, readJson } from "@/lib/beta/projects/http";
import { removeChild, updateChild } from "@/lib/beta/projects/projects";

type Context = { params: Promise<{ projectId: string; itemId: string }> };

/** Edit a question ({ text?, status?, answer? }) or rename a pasted or uploaded source ({ title }). */
export async function PATCH(req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { projectId, itemId } = await params;
		const body = await readJson(req);
		const changed = await updateChild(gate.userId, projectId, itemId, {
			...(body.text !== undefined && { text: body.text }),
			...(body.status !== undefined && { status: body.status }),
			...(body.answer !== undefined && { answer: body.answer }),
			...(body.title !== undefined && { title: body.title }),
		});
		return changed ? projectJson({ updated: true }) : betaNotFound();
	} catch (error) {
		return projectError(error, "update item");
	}
}

/** Take something out of the project. A note or highlight it pointed at is untouched. */
export async function DELETE(_req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { projectId, itemId } = await params;
		return (await removeChild(gate.userId, projectId, itemId)) ? projectJson({ deleted: true }) : betaNotFound();
	} catch (error) {
		return projectError(error, "remove item");
	}
}
