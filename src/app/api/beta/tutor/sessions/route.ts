import { getAuthUser } from "@/lib/auth";
import { requireBetaApi } from "@/lib/beta/access";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { readJsonObject, tutorError, tutorJson } from "@/lib/beta/tutor/http";
import { isTutorLevel } from "@/lib/beta/tutor/tutor-rules";
import { listSessions, resolvePassage, startSession, viewOf } from "@/lib/beta/tutor/tutor";

/**
 * GET  /api/beta/tutor/sessions -> { sessions } the founder's close readings, newest first.
 * POST /api/beta/tutor/sessions { passage: "Romans 5:1-11", level } -> 201 { session }
 *      checks the passage against the bundled KJV and asks the first question.
 * Founders only (docs/beta/README.md); everyone else gets the ordinary 404.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return tutorJson({ sessions: await listSessions(gate.userId) });
	} catch (error) {
		return tutorError(error, "list");
	}
}

const metered = withIncludedAiRequest(handleCreate, "beta-tutor");

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	return metered(req, gate.userId);
}

async function handleCreate(req: Request, userId: string): Promise<Response> {
	try {
		const body = await readJsonObject(req);
		const input = typeof body?.passage === "string" ? body.passage : "";
		if (!input.trim() || input.length > 80) return tutorJson({ error: "Type a passage, like Romans 5:1-11.", code: "invalid_passage" }, 400);
		const level = body?.level === undefined ? "growing" : body.level;
		if (!isTutorLevel(level)) return tutorJson({ error: "Choose Beginner, Growing or Deep study.", code: "invalid_level" }, 400);
		const passage = await resolvePassage(input);
		if ("error" in passage) return tutorJson({ error: passage.error, code: "invalid_passage" }, 400);
		// The session belongs to the founder's User row; a first request may come before any other route made it.
		await getAuthUser();
		const session = await startSession(userId, passage, level);
		return tutorJson({ session: await viewOf(session) }, 201);
	} catch (error) {
		return tutorError(error, "start");
	}
}
