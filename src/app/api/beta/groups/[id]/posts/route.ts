import { requireBetaApi } from "@/lib/beta/access";
import { readJson, roomErrorResponse } from "@/lib/beta/rooms/http";
import { addGroupPost } from "@/lib/beta/groups/groups";
import { groupViewResponse } from "@/lib/beta/groups/http";

/**
 * POST /api/beta/groups/:id/posts -> { group }. One of:
 * { kind: "week", reference, themes? } (a leader sets the week's passage),
 * { kind: "question", parentId, text, type, verses? } or { kind: "question",
 * parentId, draft } (a leader adds a question, typed or as SureWord prepared it),
 * { kind: "reply", parentId, body }, { kind: "session", parentId } (a leader
 * starts the guided session), { kind: "prayer", body, reference? } or
 * { kind: "prayer", memoryId } (a copy of one of your own prayer requests).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		await addGroupPost(gate.userId, id, await readJson(req));
		return await groupViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "groups post");
	}
}
