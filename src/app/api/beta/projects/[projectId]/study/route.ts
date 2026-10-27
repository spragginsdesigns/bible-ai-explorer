import { getAuthUser } from "@/lib/auth";
import { resolveModel } from "@/lib/ai/provider";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { assembleStudy } from "@/lib/beta/projects/ai";
import { projectError, projectJson, readJson } from "@/lib/beta/projects/http";
import { loadProject } from "@/lib/beta/projects/projects";

export const maxDuration = 120;

type Context = { params: Promise<{ projectId: string }> };

/**
 * Assemble an outline ({ mode: "outline" }) or a written study ({ mode:
 * "study" }) from what the project gathered, every point cited and Scripture
 * quoted from the bundled KJV. Kept in the project; saving it as a Note is a
 * separate press.
 */
const study = withIncludedAiRequest(async (req: Request, userId: string, projectId: string): Promise<Response> => {
	try {
		const body = await readJson(req);
		const mode = body.mode === "outline" ? "outline" : body.mode === "study" ? "study" : null;
		if (!mode) return projectJson({ error: "Choose an outline or a written study." }, 400);
		const project = await loadProject(userId, projectId);
		if (!project) return betaNotFound();
		const resolved = await resolveModel({ userId, structured: true });
		return projectJson({ study: await assembleStudy({ userId, project, mode, resolved }) }, 201);
	} catch (error) {
		return projectError(error, "study");
	}
}, "beta-projects-study");

export async function POST(req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		await getAuthUser();
		const { projectId } = await params;
		return await study(req, gate.userId, projectId);
	} catch (error) {
		return projectError(error, "study");
	}
}
