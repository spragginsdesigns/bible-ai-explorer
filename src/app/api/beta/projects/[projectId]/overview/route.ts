import { getAuthUser } from "@/lib/auth";
import { resolveModel } from "@/lib/ai/provider";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { generateOverview } from "@/lib/beta/projects/ai";
import { projectError, projectJson } from "@/lib/beta/projects/http";
import { loadProject } from "@/lib/beta/projects/projects";

export const maxDuration = 120;

type Context = { params: Promise<{ projectId: string }> };

/**
 * Write (or rewrite) the project's Overview: key themes with the verses that
 * carry them, connected passages chosen from SureWord's cross-references, and
 * study questions. Only when the founder asks for it.
 */
const overview = withIncludedAiRequest(async (_req: Request, userId: string, projectId: string): Promise<Response> => {
	try {
		const project = await loadProject(userId, projectId);
		if (!project) return betaNotFound();
		const resolved = await resolveModel({ userId, structured: true });
		return projectJson({ overview: await generateOverview({ userId, project, resolved }) }, 201);
	} catch (error) {
		return projectError(error, "overview");
	}
}, "beta-projects-overview");

export async function POST(req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		await getAuthUser();
		const { projectId } = await params;
		return await overview(req, gate.userId, projectId);
	} catch (error) {
		return projectError(error, "overview");
	}
}
