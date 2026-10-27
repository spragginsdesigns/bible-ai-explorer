import { requireBetaApi } from "@/lib/beta/access";
import { AiCredentialError } from "@/lib/ai/provider";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { generateConceptMap, MapGenerationError } from "@/lib/beta/maps/generate";
import { mapsJson, readJsonObject } from "@/lib/beta/maps/http";
import { THEME_MAX } from "@/lib/beta/maps/map-rules";

/**
 * POST /api/beta/maps/generate { theme } -> { map, retrieval }: a draft
 * Concept Map for any theme, built from verses retrieved for it
 * (`src/lib/beta/maps/generate.ts`). Nothing is saved; the founder edits the
 * draft and saves it through POST /api/beta/maps. Runs only on a founder's
 * request, on the house model and metered like any included AI call. Gated
 * before the usage meter, so anyone off the list gets the ordinary 404
 * whatever they send.
 *
 * 400 bad theme, 422 a theme Scripture does not speak to (or too few verses),
 * 502 a draft that failed its checks, 403 no AI credential on this server.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	return generate(req, gate.userId);
}

const generate = withIncludedAiRequest(async (req: Request, userId: string): Promise<Response> => {
	const body = await readJsonObject(req);
	const theme = typeof body?.theme === "string" ? body.theme.replace(/\s+/g, " ").trim() : "";
	if (!theme || !/[a-z]/i.test(theme)) return mapsJson({ error: "Name a theme to map, like the Holy Spirit in Acts." }, 400);
	if (theme.length > THEME_MAX) return mapsJson({ error: `Keep the theme under ${THEME_MAX} characters.` }, 400);
	try {
		return mapsJson(await generateConceptMap(userId, theme, req.signal));
	} catch (error) {
		if (error instanceof MapGenerationError) return mapsJson({ error: error.message }, error.status);
		if (error instanceof AiCredentialError) return mapsJson({ error: error.message }, 403);
		if (error instanceof Response) return error;
		console.error("concept map generation failed:", error);
		return mapsJson({ error: "The map could not be built right now. Please try again." }, 502);
	}
}, "beta-maps");
