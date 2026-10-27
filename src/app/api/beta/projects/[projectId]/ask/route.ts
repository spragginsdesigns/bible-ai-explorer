import { getAuthUser } from "@/lib/auth";
import { resolveModel } from "@/lib/ai/provider";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { askProject, QUESTION_MAX_LENGTH } from "@/lib/beta/projects/ai";
import { projectError, projectJson, readJson } from "@/lib/beta/projects/http";
import { loadProject } from "@/lib/beta/projects/projects";

export const maxDuration = 120;

type Context = { params: Promise<{ projectId: string }> };

/**
 * The project's assistant: answers one question only from the project's
 * passages, notes, highlights and sources, with every claim's citation checked
 * (src/lib/beta/projects/ai.ts). Runs only when the founder asks. The gate
 * comes before the meter, so nobody off the list can reach either.
 * Body: { question }
 */
const ask = withIncludedAiRequest(async (req: Request, userId: string, projectId: string): Promise<Response> => {
	try {
		const body = await readJson(req);
		const question = typeof body.question === "string" ? body.question.trim() : "";
		if (!question) return projectJson({ error: "Ask a question first." }, 400);
		if (question.length > QUESTION_MAX_LENGTH) return projectJson({ error: `Keep the question under ${QUESTION_MAX_LENGTH} characters.` }, 400);
		const project = await loadProject(userId, projectId);
		if (!project) return betaNotFound();
		const resolved = await resolveModel({ userId, structured: true });
		const answer = await askProject({ userId, project, question, resolved });
		return projectJson({ answer }, 201);
	} catch (error) {
		return projectError(error, "ask");
	}
}, "beta-projects-ask");

export async function POST(req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		await getAuthUser();
		const { projectId } = await params;
		return await ask(req, gate.userId, projectId);
	} catch (error) {
		return projectError(error, "ask");
	}
}
