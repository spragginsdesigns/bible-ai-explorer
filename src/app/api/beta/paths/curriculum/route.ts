import { z } from "zod";
import { requireBetaApi } from "@/lib/beta/access";
import { AiCredentialError } from "@/lib/ai/provider";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { cleanTopic } from "@/lib/beta/paths/content-rules";
import { CurriculumUnavailableError, createCurriculum } from "@/lib/beta/paths/curriculum";
import { pathsFailure, pathsJson, pathsServerError, readBody } from "@/lib/beta/paths/http";
import { isPathsError } from "@/lib/beta/paths/server";

export const dynamic = "force-dynamic";
// One structured outline call plus Scripture search.
export const maxDuration = 120;

const topicSchema = z.object({ topic: z.string() });

/**
 * POST /api/beta/paths/curriculum (Learning Paths, LC-17648): build a personal
 * curriculum around `{ topic }`, foundations first. Runs the model only on
 * this request, checks every passage against the KJV, and answers
 * `{ pathId }`. Gated before the usage meter, so anyone off the list gets the
 * ordinary 404 whatever they send.
 */
export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	return build(req, gate.userId);
}

const build = withIncludedAiRequest(async (req: Request, userId: string): Promise<Response> => {
	const parsed = topicSchema.safeParse(await readBody(req));
	const topic = parsed.success ? cleanTopic(parsed.data.topic) : null;
	if (!topic) return pathsJson({ error: "Name a topic in a few words, like the covenants or the Holy Spirit." }, 400);
	try {
		const result = await createCurriculum(userId, topic);
		return isPathsError(result) ? pathsFailure(result) : pathsJson(result, 201);
	} catch (error) {
		if (error instanceof AiCredentialError) return pathsJson({ error: error.message }, 403);
		if (error instanceof CurriculumUnavailableError) {
			console.error("[api/beta/paths/curriculum]", error.message);
			return pathsJson({ error: "That curriculum could not be built right now. Please try again." }, 502);
		}
		return pathsServerError("curriculum", error);
	}
}, "beta-paths");
