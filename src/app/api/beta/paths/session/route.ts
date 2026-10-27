import { z } from "zod";
import { requireBetaApi } from "@/lib/beta/access";
import { pathsFailure, pathsJson, pathsServerError, readBody } from "@/lib/beta/paths/http";
import { isPathsError, startSession } from "@/lib/beta/paths/server";

export const dynamic = "force-dynamic";

const startSchema = z.object({
	pathId: z.string().min(1).max(60),
	kind: z.enum(["lesson", "review", "checkpoint"]),
	target: z.string().max(60).default(""),
	restart: z.boolean().optional(),
});

/**
 * POST /api/beta/paths/session (Learning Paths, LC-17648): start a lesson, a
 * unit checkpoint or a review, or pick up the one under way where it stopped.
 * Body `{ pathId, kind, target, restart? }`; answers the session view.
 */
export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const parsed = startSchema.safeParse(await readBody(req));
	if (!parsed.success) return pathsJson({ error: "Send { pathId, kind, target }." }, 400);
	try {
		const { pathId, kind, target, restart } = parsed.data;
		const result = await startSession(gate.userId, pathId, kind, target, Boolean(restart));
		return isPathsError(result) ? pathsFailure(result) : pathsJson(result);
	} catch (error) {
		return pathsServerError("session", error);
	}
}
