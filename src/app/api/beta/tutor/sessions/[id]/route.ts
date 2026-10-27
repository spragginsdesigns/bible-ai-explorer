import { requireBetaApi } from "@/lib/beta/access";
import { readJsonObject, tutorError, tutorJson } from "@/lib/beta/tutor/http";
import { isTutorLevel } from "@/lib/beta/tutor/tutor-rules";
import { changeSession, loadSession, removeSession, viewOf } from "@/lib/beta/tutor/tutor";

/**
 * GET    /api/beta/tutor/sessions/:id -> { session } with the passage from the bundled KJV.
 * PATCH  { level?, paused? } -> { session }: the founder's own level, or pause.
 * DELETE -> { deleted: true }
 * A missing, foreign or other module's id is a 404, like the beta itself.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const loaded = await loadSession(gate.userId, (await params).id);
		if (!loaded) return tutorJson({ error: "Not found" }, 404);
		return tutorJson({ session: await viewOf(loaded) });
	} catch (error) {
		return tutorError(error, "read");
	}
}

export async function PATCH(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const body = await readJsonObject(req);
		if (!body) return tutorJson({ error: "invalid_body" }, 400);
		if (body.level !== undefined && !isTutorLevel(body.level)) return tutorJson({ error: "invalid_level" }, 400);
		if (body.paused !== undefined && typeof body.paused !== "boolean") return tutorJson({ error: "invalid_paused" }, 400);
		if (body.level === undefined && body.paused === undefined) return tutorJson({ error: "nothing_to_change" }, 400);
		const changed = await changeSession(gate.userId, (await params).id, {
			level: isTutorLevel(body.level) ? body.level : undefined,
			paused: typeof body.paused === "boolean" ? body.paused : undefined,
		});
		if (changed === "conflict") return tutorJson({ error: "stale" }, 409);
		if (!changed) return tutorJson({ error: "Not found" }, 404);
		return tutorJson({ session: await viewOf(changed) });
	} catch (error) {
		return tutorError(error, "change");
	}
}

export async function DELETE(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const deleted = await removeSession(gate.userId, (await params).id);
		return deleted ? tutorJson({ deleted: true }) : tutorJson({ error: "Not found" }, 404);
	} catch (error) {
		return tutorError(error, "delete");
	}
}
