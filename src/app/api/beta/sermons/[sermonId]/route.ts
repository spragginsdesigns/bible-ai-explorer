import { requireBetaApi } from "@/lib/beta/access";
import { readBody, sermonsFailure, sermonsJson, sermonsServerError } from "@/lib/beta/sermons/http";
import { deleteSermon, isSermonsError, sermonView, updateSermon } from "@/lib/beta/sermons/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sermonId: string }> };

/** GET /api/beta/sermons/<id> (Sermon to Study, LC-17643): the sermon, its passages and its study. */
export async function GET(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const view = await sermonView(gate.userId, (await params).sermonId);
		return view ? sermonsJson(view) : sermonsJson({ error: "Not found" }, 404);
	} catch (error) {
		return sermonsServerError("get", error, "The sermon could not be loaded.");
	}
}

/** PATCH: `{ title }` renames it; `{ research: { question, marked } }` marks one of its questions for later research. */
export async function PATCH(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const body = await readBody(req);
	if (!body) return sermonsJson({ error: "Send what to change." }, 400);
	try {
		const research = typeof body.research === "object" && body.research !== null ? (body.research as { question: unknown; marked: unknown }) : undefined;
		const result = await updateSermon(gate.userId, (await params).sermonId, { title: body.title, research });
		return isSermonsError(result) ? sermonsFailure(result) : sermonsJson(result);
	} catch (error) {
		return sermonsServerError("update", error, "The sermon could not be saved.");
	}
}

/** DELETE: the sermon, its transcript and its study. */
export async function DELETE(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return (await deleteSermon(gate.userId, (await params).sermonId)) ? sermonsJson({ deleted: true }) : sermonsJson({ error: "Not found" }, 404);
	} catch (error) {
		return sermonsServerError("delete", error, "The sermon could not be deleted.");
	}
}
