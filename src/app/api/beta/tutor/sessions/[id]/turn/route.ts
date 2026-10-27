import { requireBetaApi } from "@/lib/beta/access";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { readJsonObject, tutorError, tutorJson } from "@/lib/beta/tutor/http";
import { checkActionInput } from "@/lib/beta/tutor/tutor-rules";
import { takeTurn, viewOf } from "@/lib/beta/tutor/tutor";

/**
 * POST /api/beta/tutor/sessions/:id/turn
 *   { action: "answer" | "hint" | "reading" | "conclude", text?, expect }
 *   -> { session } with the founder's turn and the tutor's reply appended.
 * `expect` is the number of turns the founder's screen shows; a doubled or
 * stale send gets 409 instead of a second, crossed reply.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

const metered = withIncludedAiRequest(handleTurn, "beta-tutor");

export async function POST(req: Request, context: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	return metered(req, gate.userId, (await context.params).id);
}

async function handleTurn(req: Request, userId: string, id: string): Promise<Response> {
	try {
		const input = checkActionInput(await readJsonObject(req));
		if (!input.ok) return tutorJson({ error: input.error }, 400);
		const outcome = await takeTurn(userId, id, input.value);
		if (!outcome.ok) return tutorJson({ error: outcome.error === "not_found" ? "Not found" : outcome.error }, outcome.status);
		return tutorJson({ session: await viewOf(outcome.session) });
	} catch (error) {
		return tutorError(error, "turn");
	}
}
