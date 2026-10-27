import { requireBetaApi } from "@/lib/beta/access";
import { writtenCourse } from "@/lib/beta/paths/catalog";
import { pathsJson, pathsServerError } from "@/lib/beta/paths/http";
import { restartPath } from "@/lib/beta/paths/server";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/beta/paths/enrollment?pathId=<id> (Learning Paths, LC-17648):
 * start a path over. Its lessons, checkpoints and review list go; what the
 * founder has shown of each concept stays.
 */
export async function DELETE(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const pathId = new URL(req.url).searchParams.get("pathId")?.trim() ?? "";
	if (!pathId || pathId.length > 60) return pathsJson({ error: "Send ?pathId=<path>." }, 400);
	// A course is started over in SureWord Academy (LC-17660), which clears its milestones with it.
	if (writtenCourse(pathId)) return pathsJson({ error: "Not found" }, 404);
	try {
		return (await restartPath(gate.userId, pathId)) ? pathsJson({ restarted: true }) : pathsJson({ error: "Not found" }, 404);
	} catch (error) {
		return pathsServerError("enrollment", error);
	}
}
