import { requireBetaApi } from "@/lib/beta/access";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { tutorError, tutorJson } from "@/lib/beta/tutor/http";
import { saveSessionNote, viewOf } from "@/lib/beta/tutor/tutor";

/**
 * POST /api/beta/tutor/sessions/:id/note -> { noteId, noteTitle, created, session }
 * Saves the session and what was learned as a note in Notes; a later save
 * appends what happened since.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

const metered = withIncludedAiRequest(handleSave, "beta-tutor");

export async function POST(req: Request, context: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	return metered(req, gate.userId, (await context.params).id);
}

async function handleSave(_req: Request, userId: string, id: string): Promise<Response> {
	try {
		const outcome = await saveSessionNote(userId, id);
		if (!outcome.ok) return tutorJson({ error: outcome.error === "not_found" ? "Not found" : outcome.error }, outcome.status);
		return tutorJson({
			noteId: outcome.noteId,
			noteTitle: outcome.noteTitle,
			created: outcome.created,
			session: await viewOf(outcome.session),
		});
	} catch (error) {
		return tutorError(error, "note");
	}
}
