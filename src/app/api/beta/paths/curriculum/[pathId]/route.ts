import { requireBetaApi } from "@/lib/beta/access";
import { deleteCurriculum } from "@/lib/beta/paths/curriculum";
import { pathsJson, pathsServerError } from "@/lib/beta/paths/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pathId: string }> };

/** DELETE /api/beta/paths/curriculum/<pathId> (Learning Paths, LC-17648): delete a personal curriculum and its progress. */
export async function DELETE(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { pathId } = await params;
		return (await deleteCurriculum(gate.userId, pathId)) ? pathsJson({ deleted: true }) : pathsJson({ error: "Not found" }, 404);
	} catch (error) {
		return pathsServerError("curriculum delete", error);
	}
}
